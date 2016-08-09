if (!process.env.token) {
    console.log('Error: Specify token in environment');
    process.exit(1);
}

var Botkit = require('botkit');

var controller = Botkit.slackbot({
    debug: false
    //include "log: false" to disable logging
    //or a "logLevel" integer from 0 to 7 to adjust logging verbosity
});

// connect the bot to a stream of messages
controller.spawn({
        token: process.env.token
}).startRTM();

// give the bot something to listen for.
controller.hears(['challenge!', 'foos me'],['direct_message','direct_mention','mention', 'ambient'],function(bot,message) {

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
        var victim = eligibleMembers[Math.floor(Math.random()*eligibleMembers.length)];

        console.log('Victim: ' + victim);

        bot.api.users.info({user:challenger}, function(err, response) {
            var challengerName = response.user.name;

            bot.api.users.info({user:victim}, function(err, response) {
                var victimName = response.user.name;

                bot.reply(message, "The match is @" + challengerName + " VS @" + victimName);

            });
        });

    });

});

console.log('Foosbot online!');