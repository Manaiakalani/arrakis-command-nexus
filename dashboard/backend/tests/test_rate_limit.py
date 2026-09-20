import unittest

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from middleware.rate_limit import RateLimitMiddleware
from services.auth_service import SESSION_COOKIE


async def ping(_request: Request) -> JSONResponse:
    return JSONResponse({"ok": True})


def _app() -> Starlette:
    app = Starlette(routes=[Route("/api/v1/dashboard/overview", ping), Route("/mutate", ping, methods=["POST"])])
    app.add_middleware(RateLimitMiddleware)
    return app


class RateLimitTests(unittest.TestCase):
    def test_session_get_is_not_burst_limited(self) -> None:
        client = TestClient(_app())
        cookies = {SESSION_COOKIE: "x" * 43}
        for _ in range(40):
            response = client.get("/api/v1/dashboard/overview", cookies=cookies)
            self.assertEqual(response.status_code, 200, response.text)

    def test_anonymous_post_is_still_limited(self) -> None:
        client = TestClient(_app())
        codes = [client.post("/mutate").status_code for _ in range(90)]
        self.assertIn(429, codes)


if __name__ == "__main__":
    unittest.main()
