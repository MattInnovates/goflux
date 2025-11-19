# Release Notes - v0.4.2

**Release Date:** November 19, 2025

## Overview

v0.4.2 is a **critical security release** that patches a serious directory traversal vulnerability discovered in the file storage system. This vulnerability allowed authenticated users to access files outside the intended storage directory, including sensitive configuration files and system files.

## Critical Security Fix

### Directory Traversal Vulnerability (CVE-PENDING)

**Severity:** HIGH - Authenticated users could access arbitrary files on the server

**Description:**
The storage system was vulnerable to path traversal attacks where authenticated users could use relative path sequences (`../`, `../../`) to escape the configured storage directory and access sensitive files anywhere on the server filesystem.

**Attack Vector:**
```bash
# Example attack that would succeed in v0.4.1 and earlier:
goflux get ../../tokens.json /tmp/stolen_tokens.json
goflux get ../../../etc/passwd /tmp/passwd
```

**Impact:**
- Unauthorized access to authentication tokens (`tokens.json`)
- Exposure of server configuration files
- Potential access to system files and other sensitive data
- Complete compromise of server confidentiality for authenticated users

### Security Improvements

**Path Sanitization Implementation**
- Added comprehensive path validation in `pkg/storage/storage.go`
- New `sanitizePath()` method prevents directory traversal
- All storage operations now validate paths before filesystem access

**Technical Details:**

**Path Validation Process:**
1. **Path Cleaning** - Resolves `.` and `..` components using `filepath.Clean()`
2. **Relative Path Enforcement** - Strips leading slashes to ensure relative paths
3. **Boundary Validation** - Compares absolute paths to ensure result stays within storage root
4. **Traversal Detection** - Returns explicit error for path traversal attempts

**Updated Storage Methods:**
- `Put()` - Now validates paths before writing files
- `Get()` - Now validates paths before reading files  
- `Exists()` - Now validates paths before checking existence
- `List()` - Now validates paths before listing directories

**Error Handling:**
- Path traversal attempts return: `"invalid path: path traversal attempt detected: <path>"`
- Malformed paths are rejected with descriptive error messages
- Failed validation prevents any filesystem access

## Security Testing

**Attack Mitigation Verified:**
```bash
# These attacks now fail with proper error messages:
goflux get ../../tokens.json → ERROR: invalid path: path traversal attempt detected
goflux get ../config.json → ERROR: invalid path: path traversal attempt detected  
goflux get /etc/passwd → ERROR: invalid path: path traversal attempt detected
```

**Legitimate Operations Unchanged:**
```bash
# Normal file operations continue to work:
goflux get file.txt → ✅ Success
goflux get folder/file.txt → ✅ Success
goflux ls subfolder → ✅ Success
```

## Breaking Changes

**None** - This is a security patch that maintains full backward compatibility for legitimate use cases.

## Upgrade Instructions

**IMMEDIATE UPGRADE RECOMMENDED**

1. **Stop your goflux server:**
   ```bash
   # Kill the running server process
   ```

2. **Build and deploy v0.4.2:**
   ```bash
   go build -o bin/goflux-server.exe ./cmd/goflux-server
   go build -o bin/goflux.exe ./cmd/goflux
   ```

3. **Restart server with new binary:**
   ```bash
   ./goflux-server -config goflux.json
   ```

4. **Verify security fix:**
   ```bash
   # This should now fail with an error:
   ./goflux get ../../tokens.json test.json
   ```

## Security Advisory

**CVE Status:** Pending assignment  
**CVSS Score:** 8.1 (HIGH) - AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N

**Affected Versions:** All versions prior to v0.4.2  
**Fixed Version:** v0.4.2+

**Recommendation:** Immediate upgrade required for all deployments

## Acknowledgments

Thanks to the security research community for responsible disclosure practices. If you discover security vulnerabilities, please report them responsibly to the project maintainers.

## Technical Specifications

**Go Version:** 1.21+  
**Platforms:** Windows, Linux, macOS  
**Dependencies:** No new dependencies added

---

**For technical support or security questions, please contact the development team.**