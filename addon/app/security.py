"""Paranoid Security Guard & Path Jail Module for HA Addon."""

import fnmatch
import hmac
import os
import pathlib
import re

REDACTED = "***REDACTED***"

# Sensitive files and patterns that must never be accessed or exposed
DENY_LIST_PATTERNS = [
    "secrets.yaml",
    "ip_bans.yaml",
    "*.pem",
    "*.key",
    "id_rsa*",
]

DENY_LIST_RELATIVE_PATHS = [
    ".storage/core.auth",
    ".storage/core.config_entries",
]

# Sensitive keys for log sanitization
SENSITIVE_KEY_NAMES = [
    "api_key",
    "apikey",
    "access_token",
    "client_secret",
    "ha_key",
    "ha_token",
    "auth_token",
    "password",
    "passwd",
    "secret",
    "webhook_id",
    "private_key",
]

_SENSITIVE_KEYS_REGEX = "|".join(re.escape(k) for k in SENSITIVE_KEY_NAMES)

# Regex 1: URI with embedded credentials (e.g. http://user:pass@host)
_URI_CREDENTIALS_RE = re.compile(
    r"([a-zA-Z][a-zA-Z0-9+.-]*://[^:\s/@]+:)([^@\s/]+)(@)",
    re.IGNORECASE,
)

# Regex 2: Bearer tokens (e.g. Bearer eyJhbGciOi...)
_BEARER_TOKEN_RE = re.compile(
    r"(Bearer\s+)[^\s\"',;]+",
    re.IGNORECASE,
)


class SecurityException(Exception):
    """Custom exception raised on security policy or path jail violations."""
    pass


def verify_api_key(provided_key: str | None, expected_key: str | None) -> bool:
    """Verify an API key using constant-time comparison to prevent timing attacks.

    Args:
        provided_key: The API key provided in the request.
        expected_key: The expected API key configured for the addon.

    Returns:
        bool: True if the keys match, False otherwise.
    """
    if not provided_key or not expected_key:
        return False
    
    return hmac.compare_digest(
        str(provided_key).encode("utf-8"),
        str(expected_key).encode("utf-8"),
    )


# Regex 3: Quoted key-value pairs (e.g. "password": "value" or 'api_key'='value' or password: 'value')
_QUOTED_KEY_VALUE_RE = re.compile(
    rf"""(?i)(["']?)\b({_SENSITIVE_KEYS_REGEX})\b\1(\s*[:=]\s*)(["'])(?:(?!\4).)*?\4"""
)

# Regex 4: Unquoted key-value pairs (e.g. api_key=secret or password: secret)
_UNQUOTED_KEY_VALUE_RE = re.compile(
    rf"""(?i)(["']?)\b({_SENSITIVE_KEYS_REGEX})\b\1(\s*[:=]\s*)([^\s\"',;&}}\]]+)"""
)


def sanitize_path(config_root: str, requested_path: str) -> str:
    """Sanitize and validate a requested file path against the jail root and deny-list.

    Resolves canonical path with os.path.realpath, enforces containment strictly
    within config_root, and blocks access to sensitive files/patterns.

    Args:
        config_root: The root directory for the jail (e.g. /config).
        requested_path: The relative or absolute path requested by the client.

    Returns:
        str: The absolute canonical path if valid and permitted.

    Raises:
        SecurityException: If path traversal is attempted or sensitive files are accessed.
    """
    if not requested_path or not config_root:
        raise SecurityException("Invalid path: requested_path and config_root must not be empty")

    if "\0" in requested_path or "\0" in config_root:
        raise SecurityException("Invalid path: contains null bytes")

    canonical_root = os.path.realpath(os.path.abspath(config_root))

    if os.path.isabs(requested_path):
        candidate_path = os.path.abspath(requested_path)
    else:
        candidate_path = os.path.abspath(os.path.join(canonical_root, requested_path))

    canonical_path = os.path.realpath(candidate_path)

    # 1. Enforce strict jail containment within canonical_root
    try:
        common = os.path.commonpath([canonical_root, canonical_path])
        if common != canonical_root:
            raise SecurityException(
                f"Path traversal violation: requested path '{requested_path}' resolves outside jail root '{config_root}'"
            )
    except ValueError:
        raise SecurityException(
            f"Path traversal violation: requested path '{requested_path}' is on a different drive/root"
        )

    # 2. Check deny-list patterns against filename and relative path
    rel_path = os.path.relpath(canonical_path, canonical_root)
    rel_posix = pathlib.Path(rel_path).as_posix().lower()
    filename = os.path.basename(canonical_path).lower()

    # Check deny-list relative paths (e.g. .storage/core.auth, .storage/core.config_entries)
    for denied_rel in DENY_LIST_RELATIVE_PATHS:
        denied_norm = denied_rel.lower()
        if rel_posix == denied_norm or rel_posix.startswith(f"{denied_norm}/") or rel_posix.startswith(f"{denied_norm}."):
            raise SecurityException(f"Access denied: '{requested_path}' matches protected system path '{denied_rel}'")

    # Check filename deny patterns (e.g. secrets.yaml, ip_bans.yaml, *.pem, *.key, id_rsa*)
    for pattern in DENY_LIST_PATTERNS:
        if fnmatch.fnmatch(filename, pattern.lower()):
            raise SecurityException(f"Access denied: '{requested_path}' matches protected pattern '{pattern}'")

    return canonical_path


def sanitize_log_line(line: str) -> str:
    """Redact sensitive credential patterns from log strings.

    Replaces API keys, tokens, passwords, and embedded credentials with ***REDACTED***.

    Args:
        line: The raw log message or text.

    Returns:
        str: The sanitized text with credentials redacted.
    """
    if not line:
        return line

    # 1. Redact embedded URL credentials: http://user:pass@host -> http://user:***REDACTED***@host
    sanitized = _URI_CREDENTIALS_RE.sub(rf"\g<1>{REDACTED}\g<3>", line)

    # 2. Redact Bearer tokens: Bearer eyJ... -> Bearer ***REDACTED***
    sanitized = _BEARER_TOKEN_RE.sub(rf"\g<1>{REDACTED}", sanitized)

    # 3. Redact quoted sensitive values: "password": "secret" -> "password": "***REDACTED***"
    sanitized = _QUOTED_KEY_VALUE_RE.sub(rf"\g<1>\g<2>\g<1>\g<3>\g<4>{REDACTED}\g<4>", sanitized)

    # 4. Redact unquoted sensitive values: api_key=secret -> api_key=***REDACTED***
    sanitized = _UNQUOTED_KEY_VALUE_RE.sub(rf"\g<1>\g<2>\g<1>\g<3>{REDACTED}", sanitized)

    return sanitized
