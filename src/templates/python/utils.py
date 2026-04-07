import time


class Utils:
    def retry(self, task, on_error, max_attempts, interval_in_ms):
        max_attempts = max(round(max_attempts), 1)
        interval_in_s = interval_in_ms / 1000

        for attempt in range(1, max_attempts + 1):
            try:
                return task(attempt)
            except Exception as e:
                if on_error:
                    on_error(e, attempt)
                if attempt == max_attempts:
                    raise e

            if interval_in_ms > 0:
                time.sleep(interval_in_s)

        return None

    def convert_to_ordinal(self, i):
        suffixes = ['th', 'st', 'nd', 'rd', 'th', 'th', 'th', 'th', 'th', 'th']
        if i % 100 in (11, 12, 13):
            return f"{i}th"
        return f"{i}{suffixes[i % 10]}"

    def is_status_code_success(self, status_code):
        return 200 <= status_code <= 299


utils = Utils()
