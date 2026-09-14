import unittest

from middleware.tls import HSTS_VALUE, is_https_request


class HttpsRequestTests(unittest.TestCase):
    def test_plain_http_is_not_https(self):
        self.assertFalse(is_https_request("http"))
        self.assertFalse(is_https_request("http", None))
        self.assertFalse(is_https_request("http", ""))

    def test_https_scheme_is_https(self):
        self.assertTrue(is_https_request("https"))

    def test_forwarded_proto_wins_over_scheme(self):
        self.assertTrue(is_https_request("http", "https"))
        self.assertFalse(is_https_request("https", "http"))

    def test_forwarded_proto_uses_first_hop(self):
        self.assertTrue(is_https_request("http", "https, http"))
        self.assertFalse(is_https_request("http", "http, https"))

    def test_hsts_value_has_no_preload(self):
        self.assertEqual(HSTS_VALUE, "max-age=31536000; includeSubDomains")
        self.assertNotIn("preload", HSTS_VALUE)


if __name__ == "__main__":
    unittest.main()
