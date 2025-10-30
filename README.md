# Cafe Door Telegram Notifier

This small project polls the Mathe Cafe door status API and notifies subscribed Telegram users when the door opens or closes.

Setup
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
- Logs are stored in `data/history.json`.
