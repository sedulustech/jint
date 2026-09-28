def fetch_active_users(db):
    """Return the active users from the database."""
    return db.query("SELECT * FROM users WHERE active = 1")
