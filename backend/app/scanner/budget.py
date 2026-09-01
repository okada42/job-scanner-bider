import re

_NUM = re.compile(r"(\d[\d,]*)")


def parse_budget_range(text: str | None) -> tuple[int | None, int | None]:
    if not text:
        return None, None
    nums = [int(m.replace(",", "")) for m in _NUM.findall(text)]
    if not nums:
        return None, None
    if len(nums) == 1:
        return nums[0], nums[0]
    return min(nums[0], nums[1]), max(nums[0], nums[1])


def parse_application_count(text: str | None) -> int | None:
    if not text:
        return None
    for pattern in (r"提案数\s*(\d+)", r"応募[数者]?\s*(\d+)", r"(\d+)\s*件応募", r"応募\s*(\d+)\s*人"):
        m = re.search(pattern, text)
        if m:
            return int(m.group(1))
    return None
