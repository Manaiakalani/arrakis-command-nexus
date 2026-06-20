from __future__ import annotations

import logging
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from middleware.request_utils import get_client_ip, get_sanitized_path

logger = logging.getLogger("dune.request")


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        started_at = time.perf_counter()
        client_ip = get_client_ip(request)
        path = get_sanitized_path(request)

        try:
            response = await call_next(request)
        except Exception:
            duration_ms = (time.perf_counter() - started_at) * 1000
            logger.exception(
                "Request failed method=%s path=%s client_ip=%s duration_ms=%.2f",
                request.method,
                path,
                client_ip,
                duration_ms,
            )
            raise

        duration_ms = (time.perf_counter() - started_at) * 1000
        logger.info(
            "Request method=%s path=%s status=%s client_ip=%s duration_ms=%.2f",
            request.method,
            path,
            response.status_code,
            client_ip,
            duration_ms,
        )
        return response
