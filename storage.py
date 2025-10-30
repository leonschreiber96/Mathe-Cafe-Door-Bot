import json
import os
from typing import List

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
SUB_FILE = os.path.join(DATA_DIR, "subscribers.json")


class SubscriberStorage:
    def __init__(self):
        os.makedirs(DATA_DIR, exist_ok=True)
        if not os.path.exists(SUB_FILE):
            with open(SUB_FILE, "w", encoding="utf-8") as f:
                json.dump([], f)

    def _load(self) -> List[int]:
        try:
            with open(SUB_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            return [int(x) for x in data]
        except Exception:
            return []

    def _save(self, items: List[int]) -> None:
        tmp = SUB_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(items, f)
        os.replace(tmp, SUB_FILE)

    def add_subscriber(self, user_id: int) -> bool:
        items = self._load()
        if int(user_id) in items:
            return False
        items.append(int(user_id))
        self._save(items)
        return True
    def remove_subscriber(self, user_id: int) -> bool:
        items = self._load()
        uid = int(user_id)
        if uid not in items:
            return False
        items = [x for x in items if x != uid]
        self._save(items)
        return True

    def list_subscribers(self) -> List[int]:
        return self._load()

