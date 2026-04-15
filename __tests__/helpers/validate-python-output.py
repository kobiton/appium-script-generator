#!/usr/bin/env python3
"""
Validates a generated Python pytest zip produced by PythonAppiumScriptGenerator.

Usage: python3 validate-python-output.py <path-to-zip>
Exit 0 = all checks passed. Exit 1 = at least one check failed (details on stdout).

Checks performed:
  1. ast.parse() succeeds on every .py file  (catches ALL syntax/indentation errors)
  2. test_app.py imports AppiumBy and By      (locator code needs both at module scope)
  3. config.py uses Python True/False         (not JS true/false)
  4. config.py has @classmethod at 4-space indent (inside class body, not at col 0)
  5. test_suite.py: finally at 4-space indent (peer of try/except, not nested inside except)
  6. test_suite.py: every def test_* at module level (no leading spaces, drift check)
"""

import ast
import re
import sys
import zipfile


def validate(zip_path):
    errors = []

    with zipfile.ZipFile(zip_path) as zf:
        py_files = {
            name: zf.read(name).decode('utf-8')
            for name in zf.namelist()
            if name.endswith('.py')
        }

    if not py_files:
        errors.append('zip contains no .py files')
        return errors

    # ------------------------------------------------------------------
    # 1. Syntax check — ast.parse catches IndentationError, SyntaxError,
    #    wrong boolean literals, and broken string literals.
    # ------------------------------------------------------------------
    for name, src in sorted(py_files.items()):
        try:
            ast.parse(src)
        except SyntaxError as exc:
            errors.append(f'{name}: SyntaxError line {exc.lineno}: {exc.msg}')

    # ------------------------------------------------------------------
    # 2. test_app.py must have AppiumBy and By imported at module scope.
    #    Generated locator code uses these names; without the imports the
    #    script raises NameError at runtime before any test runs.
    # ------------------------------------------------------------------
    test_app = py_files.get('test_app.py', '')
    if 'from appium.webdriver.common.appiumby import AppiumBy' not in test_app:
        errors.append(
            'test_app.py: missing import '
            '"from appium.webdriver.common.appiumby import AppiumBy"'
        )
    if 'from selenium.webdriver.common.by import By' not in test_app:
        errors.append(
            'test_app.py: missing import '
            '"from selenium.webdriver.common.by import By"'
        )

    # ------------------------------------------------------------------
    # 3. config.py: generated boolean capabilities must use Python
    #    True/False, not JavaScript true/false.
    #    Pattern: a dict-value position — '...': true or '...': false
    # ------------------------------------------------------------------
    config = py_files.get('config.py', '')
    js_bool_re = re.compile(r"^\s+'[^']+': (true|false)[,\s]*$")
    for lineno, line in enumerate(config.splitlines(), 1):
        if js_bool_re.match(line):
            errors.append(
                f'config.py line {lineno}: JS boolean literal '
                f'(must be True/False): {line.rstrip()}'
            )

    # ------------------------------------------------------------------
    # 4. config.py: @classmethod must be indented exactly 4 spaces.
    #    When the first-line absorber was missing, @classmethod landed
    #    at column 0, placing it outside the class body.
    # ------------------------------------------------------------------
    if '    @classmethod\n' not in config and not config.endswith('    @classmethod'):
        errors.append(
            'config.py: no @classmethod found at 4-space indent — '
            'generated methods are outside the class body'
        )

    # ------------------------------------------------------------------
    # 5. test_suite.py: finally must be at 4-space indent (same level
    #    as try/except).  The original bug nested it at 8 spaces inside
    #    the except block, causing an immediate SyntaxError.
    # ------------------------------------------------------------------
    test_suite = py_files.get('test_suite.py', '')
    for lineno, line in enumerate(test_suite.splitlines(), 1):
        if line.startswith('        finally:'):
            errors.append(
                f'test_suite.py line {lineno}: "finally:" is at 8-space indent '
                f'(nested inside except block — must be at 4-space, peer of try/except)'
            )

    # ------------------------------------------------------------------
    # 6. test_suite.py: every def test_* must start at column 0.
    #    When per-device desiredCaps methods leaked +1 indent per device,
    #    the second (and later) test functions shifted right and became
    #    nested, making pytest unable to discover them.
    # ------------------------------------------------------------------
    for lineno, line in enumerate(test_suite.splitlines(), 1):
        stripped = line.lstrip()
        if stripped.startswith('def test_') and line != stripped:
            errors.append(
                f'test_suite.py line {lineno}: test function not at module level '
                f'(leading whitespace = {len(line) - len(stripped)} spaces): '
                f'{line.rstrip()}'
            )

    return errors


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print('Usage: validate-python-output.py <zip_path>', file=sys.stderr)
        sys.exit(2)

    found_errors = validate(sys.argv[1])

    if found_errors:
        for err in found_errors:
            print(f'FAIL: {err}')
        sys.exit(1)

    print(f'OK: all checks passed ({sys.argv[1]})')
    sys.exit(0)
