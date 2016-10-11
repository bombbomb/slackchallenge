const EventEmitter = require('events');

class Interactive extends EventEmitter {
    constructor(controller) {
        super();
        controller.on('interactive_message_callback', (bot, message) => {
            if (message && message.actions && message.actions.length == 1) {
                const action = message.actions[0];
                this.emit(action.name, {
                    name: action.name,
                    id: message.callback_id,
                    channel: message.channel,
                    channel_name: message.channel_name,
                    value: action.value
                }, bot, message);
            }
        });
    }

    requestWinner(bot, message, player1, player2, game) {
        bot.reply(message,{
            "text": `*${game}* is ${player1} *VS* ${player2}`,
            "attachments": [
                {
                    "text": "Report the Winner",
                    "fallback": "Unable to report game.",
                    "callback_id": `${game}`,
                    "color": "#3AA3E3",
                    "attachment_type": "default",
                    "actions": [
                        {
                            "name": "report_winner",
                            "text": `${player1}`,
                            "type": "button",
                            "value": `${player1}`,
                            "confirm": {
                                "title": `${game}: ${player1} VS ${player2}`,
                                "text": `Are you sure ${player1} won?`,
                                "ok_text": "Yes",
                                "dismiss_text": "No"
                            }
                        },
                        {
                            "name": "report_winner",
                            "text": `${player2}`,
                            "type": "button",
                            "value": `${player2}`,
                            "confirm": {
                                "title": `${game}: ${player1} VS ${player2}`,
                                "text": `Are you sure ${player2} won?`,
                                "ok_text": "Yes",
                                "dismiss_text": "No"
                            }
                        }
                    ]
                }
            ]
        });
    }

    static init(controller) {
        return new Interactive(controller);
    }
};

module.exports = Interactive.init;