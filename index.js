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
    });



controller.spawn({
        token: process.env.token
}).startRTM();

controller.hears(['challenge!', 'foos me', 'game!', "it's on!"],['direct_message','direct_mention','mention', 'ambient'],function(bot,message) {

    var challenger = message.user;

    bot.api.channels.info({channel: message.channel},function(err,response) {

        var members = response.channel.members;

        if (members.length == 1){
            return;
        }

        console.log(members);
        var eligibleMembers = [];
        for(var i=0;i<members.length;i++) {
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

        var victim = eligibleMembers[Math.floor(Math.random()*eligibleMembers.length)];

        console.log('Victim: ' + victim);

        bot.api.users.info({user:challenger}, function(err, challengerMeta) {
            bot.api.users.info({user:victim}, function(err, victimMeta) {
                holdMatch(challengerMeta, victimMeta);
            });
        });

    });


    function holdMatch(challengerMeta, victimMeta) {
        bot.startConversation(message, function (err, convo) {

            var result = 'unknown';

            convo.ask("⛹ The match is @" + challengerMeta.user.name + " *VS* @" + victimMeta.user.name + " 🏋 (win/loss/dnf)", [
                {
                    pattern: 'dnf',
                    callback: function (response, convo) {
                        result = 'dnf';
                        convo.next();
                    }
                },
                {
                    pattern: new RegExp(/^(win|i won|i win|yay|ya|yes|won)/i),
                    callback: function (response, convo) {
                        result = 'win';
                        convo.next();
                    }
                },
                {
                    pattern: new RegExp(/^(no|i lost|boo|no|n|loss|lose)/i),
                    callback: function (response, convo) {
                        result = 'loss';
                        convo.next();
                    }
                },
                {
                    default: true,
                    callback: function (response, convo) {
                        // just repeat the question
                        convo.repeat();
                        convo.next();
                    }
                }
            ]);


            convo.on('end',function(convo) {

                if (convo.status=='completed') {


                    controller.storage.channels.get(message.channel, function(err, channel_data) {
                        if (!channel_data.hasOwnProperty('stats')) {
                            channel_data.stats = {};
                        }

                        var ensureUserData = function(userMeta) {
                            if (!channel_data.stats.hasOwnProperty(userMeta.user.id)) {
                                channel_data.stats[userMeta.user.id] = {
                                    name: userMeta.user.name,
                                    win: 0,
                                    loss: 0,
                                    dnf: 0
                                };
                            }
                        };
                        ensureUserData(challengerMeta);
                        ensureUserData(victimMeta);

                        if (result == 'dnf') {
                            channel_data.stats[challengerMeta.user.id]['dnf']++;
                            channel_data.stats[victimMeta.user.id]['dnf']++;

                            var biggestLoser =
                                (channel_data.stats[challengerMeta.user.id]['dnf'] > channel_data.stats[victimMeta.user.id]['dnf']) ?
                                    channel_data.stats[challengerMeta.user.id] :
                                    channel_data.stats[victimMeta.user.id];

                            bot.reply(message, ":thumbsup: oh well, @" + biggestLoser.name + " is biggest loser with " + biggestLoser.dnf + " dnf");
                        } else {

                            var winner = channel_data.stats[challengerMeta.user.id];
                            var loser = channel_data.stats[victimMeta.user.id];
                            if (result == 'win') {
                                channel_data.stats[challengerMeta.user.id]['win']++;
                                channel_data.stats[victimMeta.user.id]['loss']++;
                            }
                            if (result == 'loss') {
                                channel_data.stats[challengerMeta.user.id]['loss']++;
                                channel_data.stats[victimMeta.user.id]['win']++;

                                winner = channel_data.stats[victimMeta.user.id];
                                loser = channel_data.stats[challengerMeta.user.id];
                            }

                            bot.reply(message, ":trophy: @" + winner.name + " increased w/l ratio to " + (winner.win/winner.loss).toPrecision(3));
                        }



                        controller.storage.channels.save(channel_data);

                    });


                } else {
                    // something happened that caused the conversation to stop prematurely
                }

            });

        });
    }

});

var hashTagTrashTalk = '#trashtalk';
controller.hears(['trashtalk!', 'trash', hashTagTrashTalk, 'notrash'],['direct_message','ambient'],function(bot , message) {
    controller.storage.channels.get(message.channel, function(err, channel_data) {
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

console.log('Foosbot online!');