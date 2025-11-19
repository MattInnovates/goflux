# Security Guidelines

## Authentication

### Token Storage

**Web UI:**
- Tokens are stored in browser `localStorage` for convenience
- Token is masked after saving (shown as `••••••••`)
- Clear token button with confirmation dialog
- Token validation: checks for SHA-256 (64 hex chars) or token ID format

**Security Considerations:**
- localStorage persists across browser sessions
- Tokens accessible via browser DevTools
- Consider clearing tokens when using shared computers

### Transport Security

**Current (v0.4.1):**
- ⚠️ **HTTP only** - tokens transmitted in plaintext
- Bearer token authentication (Authorization header)
- Suitable for internal/trusted networks

**Recommendations:**
1. **Use HTTPS** - Encrypts all traffic including tokens
2. **Internal networks only** - Don't expose to internet without TLS
3. **Firewall rules** - Restrict access to trusted IPs
4. **Token rotation** - Revoke and regenerate tokens periodically

### Token Management

**Best Practices:**

```bash
# Generate token with limited permissions
.\goflux-admin.exe create --user readonly --permissions list,download --days 7

# List all active tokens
.\goflux-admin.exe list

# Revoke compromised tokens
.\goflux-admin.exe revoke tok_abc123def456
```

**Token Format:**
- SHA-256 hash: 64 hexadecimal characters
- Token ID: `tok_` prefix + 12 hex characters (for reference only)

### Web UI Security

**Features:**
- Password input type (hidden characters)
- Token masked after saving
- Confirmation dialog for clearing token
- Format validation
- No token echo in URLs or logs

**Limitations:**
- localStorage accessible via JavaScript
- No auto-logout/session timeout
- No rate limiting (implement at network level)

## Production Deployment

### Minimum Security Requirements

```json
// goflux.json - PRODUCTION CONFIG
{
  "server": {
    "address": "127.0.0.1:8080",  // Bind to localhost only
    "storage_dir": "./data",
    "tokens_file": "tokens.json"   // Enable authentication
  }
}
```

**Then use reverse proxy (nginx/caddy) with HTTPS:**

```nginx
# nginx example
server {
    listen 443 ssl http2;
    server_name files.example.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Authorization $http_authorization;
        proxy_pass_header Authorization;
    }
}
```

### Security Checklist

- [ ] HTTPS/TLS enabled (reverse proxy)
- [ ] Server bound to localhost (not 0.0.0.0)
- [ ] Authentication enabled (`tokens_file` configured)
- [ ] Strong tokens (use goflux-admin to generate)
- [ ] Token permissions minimized (principle of least privilege)
- [ ] Firewall rules configured
- [ ] Regular token rotation policy
- [ ] Monitoring/logging enabled
- [ ] Backups encrypted
- [ ] Storage directory permissions restricted (chmod 700)

## Known Limitations

1. **No HTTPS built-in** - Use reverse proxy (nginx, caddy, traefik)
2. **No rate limiting** - Implement at firewall/proxy level
3. **No token expiry enforcement** - Relies on expiry date in tokens.json
4. **No 2FA** - Single-factor (token only)
5. **localStorage persistence** - Token survives browser restart

## Future Enhancements (Roadmap)

- [ ] TLS/HTTPS support built-in
- [ ] Session tokens with auto-expiry
- [ ] Rate limiting middleware
- [ ] Audit logging
- [ ] OAuth2/OIDC integration
- [ ] IP whitelisting
- [ ] Encrypted storage option

## Reporting Security Issues

Please report security vulnerabilities via GitHub issues or email:
- **GitHub:** https://github.com/0xRepo-Source/goflux/issues
- **Email:** security@goflux.dev (if available)

**Do not disclose vulnerabilities publicly until patched.**

## Responsible Disclosure

We follow coordinated disclosure:
1. Report issue privately
2. We acknowledge within 48 hours
3. We provide fix timeline
4. Fix released and tested
5. Public disclosure (with credit)

---

**Remember:** goflux is designed for trusted networks. For internet-facing deployments, always use HTTPS and follow production security guidelines above.
