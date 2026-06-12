use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct ErrorResponse {
    pub(crate) error: String,
}

#[derive(Debug)]
pub(crate) struct ApiError {
    pub(crate) status: StatusCode,
    pub(crate) error: String,
}

impl ApiError {
    const FORBIDDEN_RESPONSE: &'static str = "failed to verify client";

    pub(crate) fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            error: message.into(),
        }
    }

    pub(crate) fn method_not_allowed() -> Self {
        Self {
            status: StatusCode::METHOD_NOT_ALLOWED,
            error: "method not allowed".to_string(),
        }
    }

    pub(crate) fn forbidden(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            error: message.into(),
        }
    }

    pub(crate) fn untrusted_client() -> Self {
        Self::forbidden(Self::FORBIDDEN_RESPONSE)
    }

    pub(crate) fn untrusted_client_reason(message: impl Into<String>) -> Self {
        Self::forbidden(message)
    }

    pub(crate) fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            error: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = self.status;
        let reason = self.error;
        tracing::debug!(status = %status, reason = %reason, "rejected request");

        let error = if status == StatusCode::FORBIDDEN {
            ApiError::FORBIDDEN_RESPONSE.to_string()
        } else {
            reason
        };
        (status, Json(ErrorResponse { error })).into_response()
    }
}

pub(crate) type ApiResult<T> = Result<Json<T>, ApiError>;
