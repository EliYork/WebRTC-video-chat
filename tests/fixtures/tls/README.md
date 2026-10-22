# Test certificates

Self-signed localhost certificates and a public test private key, generated solely
for automated HTTPS startup tests. Never use these files for a real service or
install them in an OS/browser trust store. `other.crt` intentionally does not
match `server.key`. The release whitelist excludes all of `tests/`.
