if (!process.env.token) {
    console.log('Error: Specify token in environment');
    process.exit(1);
}

if (!process.env.redis_host) {
    console.log('Error: Specify redis_host in environment');
    process.exit(1);
}

var Botkit = require('botkit'),
    redisStorage = require('botkit-storage-redis')({host: process.env.redis_host}),
    controller = Botkit.slackbot({
        debug: false,
        storage: redisStorage
    }),
    Sentencer = require('sentencer');


var openMatches = [];


controller.spawn({
    token: process.env.token
}).startRTM();



controller.hears('help!', ['ambient'], function (bot, message) {
    var help = "You can...\n"
        + "_help!_ - see this help\n"
        + "_random!_ - to challenge a random opponent\n"
        + "_report! match name_ - to report a win or loss\n"
        + "_scores!_ - to see the leaderboard, sorted by W/L ratio\n"
        + "_trash!_ - talk some smack\n"
        + "_#trashtalk_ - teach the bot naughty language\n"
        + "_openmatches!_ - to list open matches\n"
        ;
    bot.reply(message, help);
});



function holdMatch(bot, message, challengerMeta, victimMeta) {

    var matchName = Sentencer.make("{{ adjective }} {{ noun }}");
    bot.reply(message, "The match is @" + challengerMeta.user.name + " *VS* @" + victimMeta.user.name + "! When done, say *report! " + matchName + "*");

    var match = {
        name: matchName,
        bot: bot,
        message: message,
        challengerMeta: challengerMeta,
        victimMeta: victimMeta
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

controller.hears('report!', ['ambient'],function (bot, message) {

    var matchName = message.text.replace('report!', '').trim();

    if ('' === matchName) {
        bot.reply(message, "Please enter a match name.");
        return;
    }

    var game = null;
    for (var i=0; i<openMatches.length; i++) {
        if (openMatches[i].name == matchName) {
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

    var winner = null, loser = null;

    bot.startConversation(message, function(err, convo) {

        convo.ask("Who won? " + game.challengerMeta.user.name + " or " + game.victimMeta.user.name + "? Or say nobody.", [
            {
                pattern: game.challengerMeta.user.name,
                callback: function(response,convo) {
                    winner = game.challengerMeta;
                    loser = game.victimMeta;
                    convo.next();
                }
            },
            {
                pattern: game.victimMeta.user.name,
                callback: function(response,convo) {
                    winner = game.victimMeta;
                    loser = game.challengerMeta;
                    convo.next();
                }
            },
            {
                pattern: 'nobody',
                callback: function(response,convo) {
                    convo.next();
                }
            },
            {
                default: true,
                callback: function(response,convo) {
                    convo.repeat();
                    convo.next();
                }
            }
        ]);

        convo.on('end', function (convo) {
            if (convo.status == 'completed') {
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
                                dnf: 0
                            };
                        }
                    };
                    ensureUserData(game.challengerMeta);
                    ensureUserData(game.victimMeta);


                    if (winner == null) {
                        channel_data.stats[game.challengerMeta.user.id]['dnf']++;
                        channel_data.stats[game.victimMeta.user.id]['dnf']++;
                        var biggestLoser =
                            (channel_data.stats[game.challengerMeta.user.id]['dnf'] > channel_data.stats[game.victimMeta.user.id]['dnf']) ?
                                channel_data.stats[game.challengerMeta.user.id] :
                                channel_data.stats[game.victimMeta.user.id];
                        bot.reply(message, ":thumbsup: oh well, @" + biggestLoser.name + " is biggest loser with " + biggestLoser.dnf + " dnf");
                    } else {

                        channel_data.stats[winner.user.id]['win']++;
                        channel_data.stats[loser.user.id]['loss']++;

                        bot.reply(message, ":trophy: @" + winner.user.name + " increased w/l ratio to "
                            + (channel_data.stats[winner.user.id]['win'] / channel_data.stats[winner.user.id]['loss']).toPrecision(3));
                    }
                    controller.storage.channels.save(channel_data);

                    closeMatch(matchName);
                });
            }
        });
    });

});

controller.hears('random!', ['ambient'], function (bot, message) {

    var challenger = message.user;

    bot.api.channels.info({channel: message.channel}, function (err, response) {

        var members = response.channel.members;

        if (members.length == 1) {
            return;
        }

        console.log(members);
        var eligibleMembers = [];
        for (var i = 0; i < members.length; i++) {
            if ([bot.identity.id, challenger].indexOf(members[i]) === -1) {
                eligibleMembers.push(members[i]);
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

        var victim = eligibleMembers[Math.floor(Math.random() * eligibleMembers.length)];

        //todo, if the user's not active, exclude them

        console.log('Victim: ' + victim);

        bot.api.users.info({user: challenger}, function (err, challengerMeta) {
            bot.api.users.info({user: victim}, function (err, victimMeta) {
                holdMatch(bot, message, challengerMeta, victimMeta);
            });
        });
    });
});

controller.hears('openmatches!', ['ambient'], function (bot, message) {
    if (openMatches.length == 0) {
        bot.reply(message, "There are no open matches at the moment...");
        return;
    }
    for (var i=0; i<openMatches.length; i++) {
        var match = openMatches[i];
        bot.reply(message, "*" + match.name + "* is " + match.challengerMeta.user.name + " *VS* " + match.victimMeta.user.name);
    }
});

controller.hears(['scores!'], ['direct_message', 'ambient'], function (bot, message) {
    controller.storage.channels.get(message.channel, function (err, channel_data) {
        if (channel_data == null) {
            channel_data = {id: message.channel};
        }

        if (!channel_data.hasOwnProperty('stats')) {
            channel_data.stats = {};
        }

        var sorted = [];
        for (var key in channel_data.stats) {
            if (channel_data.stats[key].win > 0 && channel_data.stats[key].loss > 0) {
                sorted.push(channel_data.stats[key]);
            }
        }

        sorted.sort(function (b, a) {
            var aRatio = a.win / a.loss;
            var bRatio = b.win / b.loss;

            if(!isFinite(aRatio-bRatio))
                return !isFinite(aRatio) ? 1 : -1;
            else
                return aRatio-bRatio;
        });

        for (var i = 0; i < sorted.length; i++) {
            bot.reply(message, "*" + (i + 1) + ".* " + sorted[i].name
                + " with " + sorted[i].win + " wins"
                + " and " + sorted[i].loss + " losses"
                + " for a ratio of " + (sorted[i].win / sorted[i].loss).toPrecision(3));
        }
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

console.log(Sentencer.make("slackchallenge is online and asks that you send prayers to her holiness {{ adjective }} {{ noun }}."));