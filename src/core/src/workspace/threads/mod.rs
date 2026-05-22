//! Workspace thread domain model.

pub mod attachment;
pub mod store;

pub use attachment::{RouteAttachment, RouteAttachmentProjection};
pub use store::{
    AgentSessionRef, HostBinding, ThreadProjection, ThreadStatus, WorkspaceThread,
    WorkspaceThreadId,
};
