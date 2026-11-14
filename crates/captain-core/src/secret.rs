//! Passwords and key passphrases, kept in the macOS login keychain under the
//! service "Captain" with the site's id as the account. Elsewhere (Linux, where
//! the tests run) they are held in memory for the life of the process.

use crate::error::{Error, Result};

const SERVICE: &str = "Captain";

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    use security_framework::passwords::{
        delete_generic_password, get_generic_password, set_generic_password,
    };

    // errSecItemNotFound
    const NOT_FOUND: i32 = -25300;

    pub fn set(account: &str, secret: &str) -> Result<()> {
        set_generic_password(SERVICE, account, secret.as_bytes())
            .map_err(|e| Error::local(format!("Couldn't save to the keychain: {e}")))
    }

    pub fn get(account: &str) -> Result<Option<String>> {
        match get_generic_password(SERVICE, account) {
            Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
            Err(e) if e.code() == NOT_FOUND => Ok(None),
            Err(e) => Err(Error::local(format!("Couldn't read the keychain: {e}"))),
        }
    }

    pub fn delete(account: &str) -> Result<()> {
        match delete_generic_password(SERVICE, account) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == NOT_FOUND => Ok(()),
            Err(e) => Err(Error::local(format!("Couldn't update the keychain: {e}"))),
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::*;
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};

    fn store() -> &'static Mutex<HashMap<String, String>> {
        static STORE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
        STORE.get_or_init(Default::default)
    }

    pub fn set(account: &str, secret: &str) -> Result<()> {
        let _ = SERVICE;
        store()
            .lock()
            .map_err(|_| Error::local("secret store poisoned"))?
            .insert(account.into(), secret.into());
        Ok(())
    }

    pub fn get(account: &str) -> Result<Option<String>> {
        Ok(store()
            .lock()
            .map_err(|_| Error::local("secret store poisoned"))?
            .get(account)
            .cloned())
    }

    pub fn delete(account: &str) -> Result<()> {
        store()
            .lock()
            .map_err(|_| Error::local("secret store poisoned"))?
            .remove(account);
        Ok(())
    }
}

pub use imp::{delete, get, set};

#[cfg(all(test, not(target_os = "macos")))]
mod tests {
    #[test]
    fn round_trips() {
        super::set("t1", "hunter2").unwrap();
        assert_eq!(super::get("t1").unwrap().as_deref(), Some("hunter2"));
        super::delete("t1").unwrap();
        assert_eq!(super::get("t1").unwrap(), None);
    }
}
