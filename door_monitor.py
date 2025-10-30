import asyncio
import logging
from typing import Callable, Optional, Any, Dict
import requests
import os
import json
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


class DoorMonitor:
    """Polls the configured URL periodically and calls a callback when status changes.

    The callback may be an async function taking a single string argument with the
    new status (e.g., 'open' or 'closed').
    """

    DEFAULT_URL = "https://door.mathe-cafe.de"

    def __init__(self, url: Optional[str] = None, interval_seconds: int = 60):
        self.url = url or self.DEFAULT_URL
        self.interval = interval_seconds
        self._last_status: Optional[str] = None
        self._session = requests.Session()

    def _build_api_url(self) -> str:
        """Return the API status URL for the configured base URL.

        If the provided URL already contains '/api/status' we'll use it as-is.
        Otherwise we append '/api/status' to the base URL.
        """
        if self.url.endswith("/api/status"):
            return self.url
        return self.url.rstrip("/") + "/api/status"

    def _fetch_api(self) -> Optional[Dict[str, Any]]:
        """Fetch the JSON from the API endpoint and return it as a dict.

        Returns None on error.
        """
        api_url = self._build_api_url()
        try:
            r = self._session.get(api_url, timeout=10)
            r.raise_for_status()
            data = r.json()
            if isinstance(data, dict):
                return data
            # Sometimes API might wrap the payload; try to be tolerant
            return None
        except Exception as e:
            logger.warning("Failed to fetch API status from %s: %s", api_url, e)
            return None

    def _history_file(self) -> str:
        data_dir = os.path.join(os.path.dirname(__file__), "data")
        os.makedirs(data_dir, exist_ok=True)
        return os.path.join(data_dir, "history.json")

    def _append_history(self, status: str) -> None:
        """Append a record to data/history.json with UTC ISO timestamp and status.

        This uses an atomic write to avoid corruption. The raw API payload is not saved.
        """
        fpath = self._history_file()
        record = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "status": status,
        }

        try:
            # Load existing
            if os.path.exists(fpath):
                with open(fpath, "r", encoding="utf-8") as f:
                    data = json.load(f) or []
            else:
                data = []
        except Exception:
            data = []

        data.append(record)

        tmp = fpath + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, fpath)

    async def fetch_status_async(self) -> str:
        """Return the current status string by calling the site's API.

        Returns: 'open', 'closed', or 'unknown'.
        """
        data = await asyncio.to_thread(self._fetch_api)
        if not data:
            return "unknown"

        status = data.get("status")
        if not status or not isinstance(status, str):
            return "unknown"
        status = status.strip().lower()
        if status in ("open", "offen"):
            return "open"
        if status in ("closed", "geschlossen"):
            return "closed"
        return "unknown"

    async def run(self, callback: Callable[[str], Optional[asyncio.Future]]):
        """Continuously poll and call callback(new_status) when the status changes.

        The callback can be async; this method will await it if so.
        """
        logger.info("Starting DoorMonitor for %s (interval=%ss)", self.url, self.interval)
        while True:
            try:
                raw = await asyncio.to_thread(self._fetch_api)
                # record raw fetch even if None
                status = "unknown"
                if raw and isinstance(raw, dict):
                    s = raw.get("status")
                    if isinstance(s, str):
                        s = s.strip().lower()
                        if s in ("open", "offen"):
                            status = "open"
                        elif s in ("closed", "geschlossen"):
                            status = "closed"

                # persist fetch to history (do not save raw payload)
                try:
                    self._append_history(status)
                except Exception:
                    logger.exception("Failed to write history record")

                if status != self._last_status:
                    logger.info("Door status changed from %s -> %s", self._last_status, status)
                    self._last_status = status
                    # allow both sync and async callbacks
                    result = callback(status)
                    if asyncio.iscoroutine(result):
                        await result
            except Exception as e:
                logger.exception("Error in monitor loop: %s", e)

            await asyncio.sleep(self.interval)
