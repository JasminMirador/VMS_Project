import { useState, useEffect } from "react";
import { useNotifications } from "../../context/NotificationContext";


const API = import.meta.env.VITE_API_URL || "";

/* =========================================================
   AUTH HEADERS
   ========================================================= */

function getAuthHeaders() {
  const token = localStorage.getItem("miradorai_token");

  return token
    ? {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      }
    : {
        "Content-Type": "application/json",
      };
}

/* =========================================================
   PENDING APPROVALS
   ========================================================= */

export default function PendingApprovalsPage() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [processingEmail, setProcessingEmail] = useState(null);

  const { showToast } = useNotifications();

  /* =======================================================
     FETCH PENDING REQUESTS
     ======================================================= */

  const fetchRequests = async () => {
    setLoading(true);
    setError("");

    try {
      const res = await fetch(
        `${API}/api/auth/admin/signup-requests`,
        {
          headers: getAuthHeaders(),
        }
      );

      const data = await res.json();

      if (res.ok) {
        const sortedRequests = (data.requests || []).sort(
          (a, b) => {
            const dateA = new Date(a.createdAt || 0);
            const dateB = new Date(b.createdAt || 0);

            return dateB - dateA;
          }
        );

        setRequests(sortedRequests);
      } else {
        setError(
          data.detail ||
            "Failed to fetch pending approval requests."
        );
      }
    } catch (err) {
      console.error(
        "Failed to fetch pending approvals:",
        err
      );

      setError(
        "Cannot connect to VMS Central Management Server."
      );
    } finally {
      setLoading(false);
    }
  };

  /* =======================================================
     INITIAL LOAD
     ======================================================= */

  useEffect(() => {
    fetchRequests();
  }, []);

  /* =======================================================
     APPROVE / REJECT
     ======================================================= */

  const handleAction = async (email, approve) => {
    setProcessingEmail(email);
    setError("");

    try {
      const res = await fetch(
        `${API}/api/auth/admin/approve-signup`,
        {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({
            email,
            approve,
          }),
        }
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(
          data.detail || "Action failed."
        );
      }

      showToast({
        title: "Success",
        body:
          data.message ||
          (approve
            ? "Account approved successfully."
            : "Account rejected successfully."),
        variant: "success",
      });

      await fetchRequests();
    } catch (err) {
      console.error(
        "Pending approval action failed:",
        err
      );

      showToast({
        title: "Error",
        body:
          err.message ||
          "Could not complete the action.",
        variant: "error",
      });
    } finally {
      setProcessingEmail(null);
    }
  };

  /* =======================================================
     DATE FORMAT
     ======================================================= */

  const getFormatDate = (dateStr) => {
    if (!dateStr) return "N/A";

    try {
      let dStr = dateStr;

      if (
        !dStr.endsWith("Z") &&
        !dStr.includes("+") &&
        !dStr.match(/-\d{2}:\d{2}$/)
      ) {
        dStr =
          dStr.replace(" ", "T") + "Z";
      }

      return new Date(dStr).toLocaleString(
        "en-US",
        {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Kolkata",
        }
      );
    } catch {
      return dateStr;
    }
  };

  /* =======================================================
     ROLE LABEL
     ======================================================= */

  const getRoleLabel = (role) => {
    switch (role) {
      case "admin":
        return "Administrator";

      case "client":
        return "Client Node";

      case "operator":
        return "Live Operator";

      default:
        return role || "Client Node";
    }
  };

  /* =======================================================
     PAGE
     ======================================================= */

  return (
    <div className="vs-page um-page">

      {/* ===================================================
          HEADER
          =================================================== */}

      <div className="vs-header um-header">
        <div>
          <h1 className="vs-title um-title">
            Pending <span>Approvals</span>
          </h1>
        </div>
      </div>

      {/* ===================================================
          ERROR
          =================================================== */}

      {error && (
        <div className="um-banner error-banner">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            width="16"
            height="16"
          >
            <circle cx="12" cy="12" r="10" />
            <line
              x1="12"
              y1="8"
              x2="12"
              y2="12"
            />
            <line
              x1="12"
              y1="16"
              x2="12.01"
              y2="16"
            />
          </svg>

          {error}
        </div>
      )}

      {/* ===================================================
          MAIN PANEL
          =================================================== */}

      <div className="vs-panel um-panel">

        <div className="vs-panel-header um-panel-header">
          <h2>
            Pending Registration Requests (
            {requests.length}
            )
          </h2>
        </div>

        <div className="vs-panel-body um-panel-body">

          {/* =================================================
              LOADING
              ================================================= */}

          {loading ? (
            <div className="vs-state-msg">
              Fetching pending requests...
            </div>

          /* =================================================
             EMPTY
             ================================================= */

          ) : requests.length === 0 ? (
            <div className="vs-state-msg">
              No pending registration requests.
            </div>

          /* =================================================
             TABLE
             ================================================= */

          ) : (
            <div className="um-table-container">

              <table className="um-table">

                <thead>
                  <tr>

                    <th>
                      Email Address
                    </th>

                    <th>
                      Assigned Role
                    </th>

                    <th>
                      Requested At
                    </th>

                    <th className="th-center">
                      Actions
                    </th>

                  </tr>
                </thead>

                <tbody>

                  {requests.map((request) => {

                    const isProcessing =
                      processingEmail ===
                      request.email;

                    return (
                      <tr
                        key={
                          request._id ||
                          request.email
                        }
                      >

                        {/* =================================
                            EMAIL
                            ================================= */}

                        <td className="td-email">

                          <div className="td-avatar">
                            {(request.email || "U")
                              .charAt(0)
                              .toUpperCase()}
                          </div>

                          <span>
                            {request.email}
                          </span>

                        </td>

                        {/* =================================
                            ROLE
                            ================================= */}

                        <td>

                          <span
                            className={`um-role-badge badge-${request.role || "client"}`}
                          >
                            {getRoleLabel(
                              request.role
                            )}
                          </span>

                        </td>

                        {/* =================================
                            DATE
                            ================================= */}

                        <td className="td-date">
                          {getFormatDate(
                            request.createdAt
                          )}
                        </td>

                        {/* =================================
                            ACTIONS
                            ================================= */}

                        <td className="td-actions">

                          {/* APPROVE */}

                          <button
                            type="button"
                            className="m-btn m-btn--primary"
                            disabled={isProcessing}
                            onClick={() =>
                              handleAction(
                                request.email,
                                true
                              )
                            }
                            title="Approve Account"
                            style={{
                              minWidth: "78px",
                              padding:
                                "7px 12px",
                            }}
                          >
                            {isProcessing
                              ? "..."
                              : "Approve"}
                          </button>

                          {/* REJECT */}

                          <button
                            type="button"
                            className="m-btn m-btn--danger"
                            disabled={isProcessing}
                            onClick={() =>
                              handleAction(
                                request.email,
                                false
                              )
                            }
                            title="Reject Account"
                            style={{
                              minWidth: "70px",
                              padding:
                                "7px 12px",
                            }}
                          >
                            {isProcessing
                              ? "..."
                              : "Reject"}
                          </button>

                        </td>

                      </tr>
                    );
                  })}

                </tbody>

              </table>

            </div>
          )}

        </div>
      </div>

    </div>
  );
}