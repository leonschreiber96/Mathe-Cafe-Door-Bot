import os
import asyncio
import logging
from dotenv import load_dotenv

from aiogram import Bot, Dispatcher, types
from aiogram.filters import Command

from door_monitor import DoorMonitor
from storage import SubscriberStorage

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def get_token() -> str:
    # Load .env file if present (overrides nothing if env already set)
    load_dotenv()
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        logger.error("TELEGRAM_BOT_TOKEN is not set. Create a .env file or set the environment variable.")
        raise SystemExit(1)
    return token


async def notify_subscribers(bot: Bot, storage: SubscriberStorage, status: str) -> None:
    text = f"Cafe door is now: {status.upper()}"
    subs = storage.list_subscribers()
    if not subs:
        logger.info("No subscribers to notify.")
        return

    for user_id in subs:
        try:
            await bot.send_message(user_id, text)
        except Exception:
            logger.exception("Failed to notify %s", user_id)


def run():
    token = get_token()

    bot = Bot(token=token)
    dp = Dispatcher()
    storage = SubscriberStorage()

    async def cmd_start(message: types.Message):
        await message.reply(
            "Hello! I will notify you when the cafe door opens or closes.\n"
            "Use /subscribe to receive notifications and /unsubscribe to stop.\n"
            "Use /status to check the current state."
        )

    async def cmd_subscribe(message: types.Message):
        user = message.from_user
        if user is None or not hasattr(user, "id") or user.id is None:
            await message.reply("Could not determine your user id. Try again or contact the bot admin.")
            return
        added = storage.add_subscriber(user.id)
        if added:
            await message.reply("Subscribed to door notifications. You will receive updates.")
        else:
            await message.reply("You are already subscribed.")

    async def cmd_unsubscribe(message: types.Message):
        user = message.from_user
        if user is None or not hasattr(user, "id") or user.id is None:
            await message.reply("Could not determine your user id. Try again or contact the bot admin.")
            return
        removed = storage.remove_subscriber(user.id)
        if removed:
            await message.reply("Unsubscribed. You will no longer receive updates.")
        else:
            await message.reply("You were not subscribed.")

    async def cmd_status(message: types.Message):
        monitor = DoorMonitor()
        status = await monitor.fetch_status_async()
        await message.reply(f"Current door status: {status}")

    dp.message.register(cmd_start, Command(commands=["start", "help", "info"]))
    dp.message.register(cmd_subscribe, Command(commands=["subscribe"]))
    dp.message.register(cmd_unsubscribe, Command(commands=["unsubscribe"]))
    dp.message.register(cmd_status, Command(commands=["status"]))

    monitor = DoorMonitor()

    async def on_change(new_status: str):
        await notify_subscribers(bot, storage, new_status)

    async def main_async():
        asyncio.create_task(monitor.run(on_change))
        await dp.start_polling(bot)

    asyncio.run(main_async())


if __name__ == "__main__":
    run()
