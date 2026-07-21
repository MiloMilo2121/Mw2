from lib.http import should_retry


def test_should_retry_only_transient_statuses():
    for s in (429, 500, 502, 503, 504):
        assert should_retry(s) is True
    for s in (200, 201, 400, 401, 403, 404, 422):
        assert should_retry(s) is False
