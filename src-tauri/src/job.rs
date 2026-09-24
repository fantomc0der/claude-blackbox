//! Ties the sidecar's lifetime to this process on Windows.
//!
//! The NSIS installer, Task Manager, and crashes all end the wrapper with
//! `TerminateProcess`, which never runs the exit hooks that stop the sidecar.
//! A job object with the kill-on-close limit makes the kernel terminate every
//! process in the job once the last handle to it closes, and the wrapper's
//! handle closes whenever the wrapper exits for any reason.

use std::{ffi::c_void, io, mem};

use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE},
    System::{
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
        Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE},
    },
};

pub struct KillOnCloseJob(HANDLE);

// The handle is an owned kernel object; the job is only ever used through
// thread-safe Win32 calls.
unsafe impl Send for KillOnCloseJob {}
unsafe impl Sync for KillOnCloseJob {}

impl KillOnCloseJob {
    pub fn new() -> io::Result<Self> {
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        let job = Self(handle);
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { mem::zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                &limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION as *const c_void,
                mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if configured == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(job)
    }

    pub fn assign(&self, pid: u32) -> io::Result<()> {
        let process = unsafe { OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid) };
        if process.is_null() {
            return Err(io::Error::last_os_error());
        }
        let assigned = unsafe { AssignProcessToJobObject(self.0, process) };
        let error = io::Error::last_os_error();
        unsafe { CloseHandle(process) };
        if assigned == 0 {
            return Err(error);
        }
        Ok(())
    }
}

impl Drop for KillOnCloseJob {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0) };
    }
}

#[cfg(test)]
mod tests {
    use super::KillOnCloseJob;
    use std::{
        process::{Command, Stdio},
        thread,
        time::{Duration, Instant},
    };

    #[test]
    fn closing_the_job_terminates_assigned_processes() {
        let job = KillOnCloseJob::new().unwrap();
        let mut child = Command::new("ping")
            .args(["-n", "30", "127.0.0.1"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        job.assign(child.id()).unwrap();
        assert!(child.try_wait().unwrap().is_none());

        drop(job);

        let deadline = Instant::now() + Duration::from_secs(10);
        while child.try_wait().unwrap().is_none() {
            assert!(
                Instant::now() < deadline,
                "the child outlived its job object"
            );
            thread::sleep(Duration::from_millis(50));
        }
    }

    #[test]
    fn assigning_a_missing_process_fails_cleanly() {
        let job = KillOnCloseJob::new().unwrap();
        assert!(job.assign(u32::MAX).is_err());
    }
}
