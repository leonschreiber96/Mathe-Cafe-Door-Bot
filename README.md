# Mathe Café Door Bot

Polls the current door status (open or closed) of Mathe Café in 8th floor of the TU Berlin math building every minute. Uses the Mathe Café door status API and notifies subscribed Telegram users when the door opens or closes.

## Setup
1. Create a bot and get a token from @BotFather on Telegram.
2. Set the token in your environment before running the bot (zsh example):

```bash
export TELEGRAM_BOT_TOKEN="<your-token-here>"
```

3. Install dependencies (if not already):

```bash
# inside your virtualenv
pip install aiogram requests python-dotenv
```

Run

```bash
python main.py
```

Commands supported (Telegram):
- /subscribe — subscribe to door notifications
- /unsubscribe — stop notifications
- /status — query current door status immediately

Notes
- Subscribers are stored in `data/subscribers.json`.
- Historical data is stored in `data/history.json`.
