import requests
import time
from config import Config


class OtpService:
    def __init__(self, kobiton_api_url=None, auth_string=None):
        self._api_url = kobiton_api_url or Config.KOBITON_API_URL
        self._auth_string = auth_string or Config.get_basic_auth_string()

    def get_otp_code(self, phone_number, created_after, max_try_times=10, interval_in_ms=5000):
        for attempt in range(1, max_try_times + 1):
            try:
                code = self._fetch_otp_code(phone_number, created_after)
                if code:
                    return code
            except Exception as e:
                print(f"Attempt {attempt} failed: {e}")

            if attempt < max_try_times:
                time.sleep(interval_in_ms / 1000)

        raise Exception(f"Cannot get OTP code for phone number: {phone_number}")

    def _fetch_otp_code(self, phone_number, created_after):
        url = f"{self._api_url}/v1/otp"
        headers = {
            'Authorization': self._auth_string,
            'Content-Type': 'application/json'
        }
        params = {
            'phoneNumber': phone_number,
            'createdAfter': created_after
        }
        response = requests.get(url, headers=headers, params=params)
        if response.status_code == 200:
            return response.json().get('otpCode')
        return None
