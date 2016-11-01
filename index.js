if (!process.env.redis_host) {
    console.log('Error: Specify redis_host in environment');
    process.exit(1);
}

var Botkit = require('botkit'),
    redisStorage = require('botkit-storage-redis')({host: process.env.redis_host}),
    Sentencer = require('sentencer');



var controller = Botkit.slackbot({
    debug: false,
    storage: redisStorage
});

const slackConfig = {
    clientId: process.env.SLACK_ID,
    clientSecret: process.env.SLACK_SECRET,
    redirectUri: process.env.SLACK_REDIRECT,
    scopes: ['bot', 'command']
};

controller.configureSlackApp(slackConfig);

// just a simple way to make sure we don't
// connect to the RTM twice for the same team
var _bots = {};
function trackBot(bot) {
    _bots[bot.config.token] = bot;
}


controller.on('create_bot',function(bot,config) {

    if (_bots[bot.config.token]) {
        // already online! do nothing.
    } else {
        bot.startRTM(function(err) {

            if (!err) {
                trackBot(bot);
            }

            bot.startPrivateConversation({user: config.createdBy},function(err,convo) {
                if (err) {
                    console.log(err);
                } else {
                    convo.say('I am a bot that has just joined your team');
                    convo.say('You must now /invite me to a channel so that I can be of use!');
                }
            });

        });
    }

});

const interactive = require('./interactive.js')(controller);

controller.setupWebserver(8080, function(err) {

    controller.webserver.get('/', (req, res) => {
       res.send('Ok')
    });

    controller.createWebhookEndpoints(controller.webserver);

    controller.createOauthEndpoints(controller.webserver,function(err,req,res) {
        if (err) {
            res.status(500).send('ERROR: ' + err);
        } else {
            res.send('Success!');
        }
    });
});

var openMatches = [];

controller.hears('help!', ['ambient'], function (bot, message) {
    var help = "You can...\n"
        + "_help!_ - see this help\n"
        + "_play!_ - opt in to get random matches\n"
        + "_players!_ - get active player list\n"
        + "_spectate!_ - opt out of getting random matches\n"
        + "_random!_ - to challenge a random opponent\n"
        + "_matched!_ - to challenge an opponent close to your rank\n"
        + "_report! match name_ - to report a win or loss\n"
        + "_scores!_ - to see the leaderboard, sorted by rank\n"
        + "_trash!_ - talk some smack\n"
        + "_#trashtalk_ - teach the bot naughty language\n"
        + "_openmatches!_ - to list your open matches\n"
        + "_odds!_ - to see the odds for open matches\n"
        ;
    bot.reply(message, help);
});


function holdMatch(bot, message, challengerMeta, victimMeta, channelId) {

    var matchName = Sentencer.make("{{ adjective }} {{ noun }}");
    bot.reply(message, "The match is @" + challengerMeta.user.name + " *VS* @" + victimMeta.user.name + "! When done, say *report! " + matchName + "*");

    var match = {
        name: matchName,
        bot: bot,
        message: message,
        challengerMeta: challengerMeta,
        victimMeta: victimMeta,
        channelId: channelId
    };

    openMatches.push(match);

}

function closeMatch(matchName){
    for (var i=0; i<openMatches.length; i++) {
        if (openMatches[i].name == matchName) {
            openMatches.splice(i, 1);
            return;
        }
    }
}

function pickVictim(message, bot, pickCallback)
{
    var challenger = message.user;

    controller.storage.channels.get(message.channel, function (err, channel_data) {
        if (channel_data == null) {
            channel_data = {id: message.channel};
        }

        if (!channel_data.hasOwnProperty('players')) {
            channel_data.players = [];
        }


        console.log(channel_data.players);
        var eligibleMembers = [];
        for (var i = 0; i < channel_data.players.length; i++) {

            if ([bot.identity.id, challenger].indexOf(channel_data.players[i]) === -1) {
                eligibleMembers.push(channel_data.players[i]);
            }
        }

        console.log(eligibleMembers);

        if (eligibleMembers.length == 0) {
            bot.reply(message, 'Get friends.');
            return;
        }

        if (eligibleMembers.length == 1) {
            bot.reply(message, 'THERE CAN BE ONLY *ONE*!');
        }

        var victim = pickCallback(eligibleMembers, challenger, channel_data);

        console.log('Victim: ' + victim);

        bot.api.users.info({user: challenger}, function (err, challengerMeta) {
            bot.api.users.info({user: victim}, function (err, victimMeta) {
                holdMatch(bot, message, challengerMeta, victimMeta, message.channel);
            });
        });
    });
}

function calcEloOdds(rank0, rank1) {
    var odds0 = 1 / (1 + Math.pow(10, (rank1 - rank0) / 400));
    var odds1 = 1 / (1 + Math.pow(10, (rank0 - rank1) / 400));
    return [odds0, odds1];
}

controller.hears('report!', ['ambient'],function (bot, message) {

    var matchName = message.text.replace('report!', '').trim();

    if ('' === matchName) {
        bot.reply(message, "Please enter a match name.");
        return;
    }

    var game = null;
    for (var i=0; i<openMatches.length; i++) {
        if (openMatches[i].name == matchName && openMatches[i].channelId == message.channel) {
            game = openMatches[i];
            break;
        }
    }

    if (null === game) {
        bot.reply(message, "There're no matches named *" + matchName + "*");
        return;
    }

    if (message.user != game.challengerMeta.user.id && message.user != game.victimMeta.user.id) {
        bot.reply(message, "Sorry, only the players can report.");
        return;
    }

    interactive.requestWinner(bot, message, game.challengerMeta, game.victimMeta, matchName);
});

controller.hears('random!', ['ambient'], function (bot, message) {
    pickVictim(message, bot, function(eligibleMembers) {
        return eligibleMembers[Math.floor(Math.random() * eligibleMembers.length)];
    });

});

controller.hears('matched!', ['ambient'], function (bot, message) {

    pickVictim(message, bot, function(eligible_members, challengerId, channel_data) {
        var challengerRank = channel_data.stats[challengerId].rank;

        var closestId = eligible_members[0];
        for (var i = 0; i < eligible_members.length; i++) {
            var playerId = eligible_members[i];

            if (channel_data.stats[playerId] == undefined) continue;

            var playerRank = channel_data.stats[playerId].rank;
            var closestRank = channel_data.stats[closestId].rank;

            var playerDiff = Math.abs(challengerRank - playerRank);
            var closestDiff = Math.abs(closestRank - challengerRank);

            if (playerDiff < closestDiff) {
                closestId = playerId;
            }
        }

        return closestId;
    });

});



controller.hears('openmatches!', ['ambient'], function (bot, message) {
    var channelMatches = openMatches.filter(function(match) { return match.channelId == message.channel; });
    if (channelMatches.length == 0) {
        bot.reply(message, "You don't have any open matches at the moment...");
        return;
    }

    bot.api.users.info({user: message.user}, function (err, queryUser) {
        var filteredMatches = channelMatches.filter(function (match) {
            return match.challengerMeta.user.name == queryUser.user.name || match.victimMeta.user.name == queryUser.user.name;
        });

        for (var i = 0; i < filteredMatches.length; i++) {
            var match = filteredMatches[i];
            interactive.requestWinner(bot, message, match.challengerMeta, match.victimMeta, match.name);
        }
    });
});

controller.hears('odds!', ['ambient'], function(bot, message) {
    var channelMatches = openMatches.filter(function(match) {
        return match.channelId == message.channel;
    });

    if (channelMatches.length == 0) {
      bot.reply(message, "There aren't any matches going on right now.");
        return;
    }

    controller.storage.channels.get(message.channel, function (err, channel_data) {
        var matchesWithOdds = [];
        for (var i = 0; i < channelMatches.length; i++) {

            var match = channelMatches[i];
            var challenger = match.challengerMeta.user;
            var victim = match.victimMeta.user;

            var challengerRank = channel_data.stats[challenger.id]['rank'] || 1500;
            var victimRank = channel_data.stats[victim.id]['rank'] || 1500;

            var odds = calcEloOdds(challengerRank, victimRank);

            matchesWithOdds.push('*' + match.name + '*: '
                + Math.round(odds[0] * 100) + '% ' + challenger.name + ' to '
                + Math.round(odds[1] * 100) + '% ' + victim.name
            );
        }
        bot.reply(message, matchesWithOdds.join("\n"));
    });
});


controller.hears(['players!'], ['ambient'], function (bot, message) {
    controller.storage.channels.get(message.channel, function (err, channel_data) {
        if (channel_data == null) {
            channel_data = {id: message.channel};
        }

        if (!channel_data.hasOwnProperty('players')) {
            channel_data.players = [];
        }

        var players = [];
        for (var i = 0; i < channel_data.players.length; i++) {
            var playerId = channel_data.players[i];
            bot.api.users.info({user: playerId}, function (err, playerMeta) {
                players.push(playerMeta.user.name);
            });
        }

        setTimeout(function() {
            bot.reply(message, "Active Players: " + players.join(', '));
        }, 1000);
    });
});

controller.hears(['play!', 'spectate!'], ['ambient'], function (bot, message) {
    console.log(message);

    controller.storage.channels.get(message.channel, function (err, channel_data) {
        if (channel_data == null) {
            channel_data = {id: message.channel};
        }

        if (!channel_data.hasOwnProperty('players')) {
            channel_data.players = [];
        }

        if (message.text.indexOf('play!') > -1) {

            if (channel_data.players.indexOf(message.user) == -1) {
                bot.reply(message, "Aight, you're in!...");
                channel_data.players.push(message.user);
            } else {
                bot.reply(message, "You're already playing!");
                return;
            }
        } else if (message.text.indexOf('spectate!') > -1) {

            var indexOfPlayer = channel_data.players.indexOf(message.user);
            if (indexOfPlayer != -1) {
                bot.reply(message, "Peace out!");
                channel_data.players.splice(indexOfPlayer, 1);
            } else {
                bot.reply(message, "You're already a spectator!");
                return;
            }
        }

        controller.storage.channels.save(channel_data);

        bot.reply(message, "There are now " + channel_data.players.length + " players.");

    });


});


controller.hears(['scores!'], ['direct_message', 'ambient'], function (bot, message) {
    controller.storage.channels.get(message.channel, function (err, channel_data) {
        if (channel_data == null) {
            channel_data = {id: message.channel};
        }

        var players = [];
        for (var key in channel_data.stats) {
            if (channel_data.stats[key].rank == undefined) {
                channel_data.stats[key].rank = 1500;
            }

            if (channel_data.stats[key].win > 0 || channel_data.stats[key].loss > 0) {
                players.push(channel_data.stats[key]);
            }
        }

        players.sort(function(player1, player2) {
            return player1.rank > player2.rank ? -1 : 1;
        });

        // Display rankings
        var ranks = [];
        players.forEach(function (player, i) {
            ranks.push("*" + (i + 1) + ".* " + player.name
            + " " + player.rank + " rank, "
            + player.win + " wins, " + player.loss + " losses");
        });

        bot.reply(
            message,
            ranks.join("\n")
        );
    });
});

var hashTagTrashTalk = '#trashtalk';
controller.hears(['trash!', hashTagTrashTalk],['direct_message','ambient'],function(bot , message) {
    controller.storage.channels.get(message.channel, function(err, channel_data) {
        if (channel_data == null) {
            channel_data = {id: message.channel};
        }

        if (!channel_data.hasOwnProperty('trash')) {
            channel_data.trash = [];
        }

        if (message.text == 'notrash') {
            channel_data.trash = [];
            controller.storage.channels.save(channel_data);
            return;
        }

        if (message.text.indexOf(hashTagTrashTalk) !== -1) {
            channel_data.trash.push(message.text.replace(hashTagTrashTalk, '').trim());
            controller.storage.channels.save(channel_data);
            bot.reply(message, "Oh, NO YOU D'NT");
        } else {
            var thatTalk = channel_data.trash[Math.floor(Math.random()*channel_data.trash.length)];
            if (thatTalk!==undefined) {
                bot.reply(message, thatTalk);
            } else {
                bot.reply(message, "Talk some trash with *#trashtalk*");
            }
        }

    });

});

interactive.on('report_winner', function(payload, bot, message) {

    var winner, loser;
    const matches = /^(.*)::(.*)$/.exec(payload.value);
    const matchName = message.callback_id;

    var game = null;
    for (var i=0; i<openMatches.length; i++) {
        if (openMatches[i].name == matchName && openMatches[i].channelId == message.channel) {
            game = openMatches[i];
            break;
        }
    }

    if (game == null) {
        bot.replyInteractive(message, "Sorry, I don't recognize that game.");
        return;
    }

    if (matches[1] == game.challengerMeta.user.id && matches[2] == game.victimMeta.user.id) {
        winner = game.challengerMeta;
        loser = game.victimMeta;
    } else if (matches[1] == game.victimMeta.user.id && matches[2] == game.challengerMeta.user.id) {
        winner = game.victimMeta;
        loser = game.challengerMeta;
    } else {
        bot.replyInteractive(message, "Sorry, I don't recognize those players.");
        return;
    }

    if (message.user != game.challengerMeta.user.id && message.user != game.victimMeta.user.id) {
        bot.reply(message, "Sorry, only the players can report.");
        return;
    }

    controller.storage.channels.get(message.channel, function (err, channel_data) {
        if (channel_data == null) {
            channel_data = {id: message.channel};
        }
        if (!channel_data.hasOwnProperty('stats')) {
            channel_data.stats = {};
        }
        var ensureUserData = function (userMeta) {
            if (!channel_data.stats.hasOwnProperty(userMeta.user.id)) {
                channel_data.stats[userMeta.user.id] = {
                    name: userMeta.user.name,
                    win: 0,
                    loss: 0,
                    dnf: 0,
                    rank: 1500
                };
            }
        };

        ensureUserData(game.challengerMeta);
        ensureUserData(game.victimMeta);

        if (winner == null)
        {
            channel_data.stats[game.challengerMeta.user.id]['dnf']++;
            channel_data.stats[game.victimMeta.user.id]['dnf']++;
            var biggestLoser =
                (channel_data.stats[game.challengerMeta.user.id]['dnf'] > channel_data.stats[game.victimMeta.user.id]['dnf']) ?
                    channel_data.stats[game.challengerMeta.user.id] :
                    channel_data.stats[game.victimMeta.user.id];
            bot.replyInteractive(message, ":thumbsup: oh well, @" + biggestLoser.name + " is biggest loser with " + biggestLoser.dnf + " dnf");
        }
        else
        {
            channel_data.stats[winner.user.id]['win']++;
            channel_data.stats[loser.user.id]['loss']++;

            var winnerRank = channel_data.stats[winner.user.id]['rank'] || 1500;
            var loserRank = channel_data.stats[loser.user.id]['rank'] || 1500;

            var odds = calcEloOdds(winnerRank, loserRank);
            var modifierWinner = odds[0];
            var modifierLoser = odds[1];

            var winnerDelta = Math.round(32 * (1 - modifierWinner));
            channel_data.stats[winner.user.id]['rank'] = winnerRank + winnerDelta;
            var loserDelta = Math.round(32 * (0 - modifierLoser));
            channel_data.stats[loser.user.id]['rank'] = loserRank + loserDelta;

            bot.replyInteractive(
                message,
                ":trophy: @" + winner.user.name + " increased rank to " + channel_data.stats[winner.user.id]['rank'] +
                " (" + winnerDelta + "). @" + loser.user.name + " decreased rank to " +
                channel_data.stats[loser.user.id]['rank'] + " (" + loserDelta + ")");
        }
        controller.storage.channels.save(channel_data);

        closeMatch(matchName);
    });
});

// Connect to channels that the bot is in and has access to.
controller.storage.teams.all(function(err,teams) {
    if (err) {
        throw new Error(err);
    }

    for (var t  in teams) {
        if (teams[t].bot) {
            controller.spawn(teams[t]).startRTM(function(err, bot) {
                if (err) {
                    console.log('Error connecting bot to Slack:',err);
                } else {
                    trackBot(bot);
                }
            });
        }
    }

});

console.log(Sentencer.make("slackchallenge is online and asks that you send prayers to her holiness {{ adjective }} {{ noun }}."));
