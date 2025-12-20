import React, { useState } from "react";
import { CloseIcon, CopyIcon, CheckIcon } from "./icons";
import { styles } from "../styles";

interface McpConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function McpConnectionModal({ isOpen, onClose }: McpConnectionModalProps) {
  const [activeTab, setActiveTab] = useState<"chatgpt" | "claude">("chatgpt");
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const toggleStep = (stepId: string) => {
    const newExpanded = new Set(expandedSteps);
    if (newExpanded.has(stepId)) {
      newExpanded.delete(stepId);
    } else {
      newExpanded.add(stepId);
    }
    setExpandedSteps(newExpanded);
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(mcpServerUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy URL:", err);
    }
  };

  const mcpServerUrl = "https://oops402.com/mcp";

  return (
    <div style={styles.modal} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ ...styles.modalContent, maxWidth: "700px", maxHeight: "85vh" }}>
        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitle}>Connect to ChatGPT or Claude</h2>
          <button
            onClick={onClose}
            style={styles.closeButton}
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </div>

        <div style={{ marginBottom: "1.5rem", padding: "1rem", background: "rgba(0, 82, 255, 0.08)", borderRadius: "8px", border: "1px solid rgba(0, 82, 255, 0.2)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <p style={{ margin: 0, fontSize: "0.875rem", fontWeight: 600, color: "#333" }}>MCP Server URL</p>
            <button
              onClick={handleCopyUrl}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.375rem",
                padding: "0.375rem 0.75rem",
                background: copied ? "#00D4A1" : "rgba(0, 82, 255, 0.1)",
                border: "1px solid",
                borderColor: copied ? "#00D4A1" : "rgba(0, 82, 255, 0.3)",
                borderRadius: "6px",
                cursor: "pointer",
                color: copied ? "white" : "#0052FF",
                fontSize: "0.875rem",
                fontWeight: 500,
                transition: "all 0.2s",
              }}
              title={copied ? "Copied!" : "Copy URL"}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
              <span>{copied ? "Copied!" : "Copy"}</span>
            </button>
          </div>
          <code 
            onClick={handleCopyUrl}
            style={{ 
              display: "block", 
              padding: "0.5rem", 
              background: "rgba(0, 0, 0, 0.05)", 
              borderRadius: "6px", 
              fontFamily: "monospace", 
              fontSize: "0.9rem", 
              color: "#0052FF",
              wordBreak: "break-all",
              cursor: "pointer",
              transition: "background 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(0, 82, 255, 0.1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(0, 0, 0, 0.05)";
            }}
            title="Click to copy"
          >{mcpServerUrl}</code>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", borderBottom: "2px solid rgba(0, 0, 0, 0.1)" }}>
          <button
            onClick={() => setActiveTab("chatgpt")}
            style={{
              ...styles.tab,
              ...(activeTab === "chatgpt" ? styles.tabActive : {}),
              marginBottom: "-2px",
            }}
          >
            ChatGPT
          </button>
          <button
            onClick={() => setActiveTab("claude")}
            style={{
              ...styles.tab,
              ...(activeTab === "claude" ? styles.tabActive : {}),
              marginBottom: "-2px",
            }}
          >
            Claude
          </button>
        </div>

        {activeTab === "chatgpt" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div style={{ 
              background: "#f5f7fa", 
              borderRadius: "8px", 
              border: "1px solid #e0e0e0",
              overflow: "hidden"
            }}>
              <button
                onClick={() => toggleStep("chatgpt-1")}
                style={{
                  width: "100%",
                  padding: "1rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ fontSize: "1rem", fontWeight: 600, color: "#1a1a1a" }}>
                  Step 1: Enable Developer Mode in ChatGPT
                </span>
                <svg 
                  style={{ 
                    width: "1.5rem", 
                    height: "1.5rem", 
                    transform: expandedSteps.has("chatgpt-1") ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.3s",
                    color: "#0052FF"
                  }} 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {expandedSteps.has("chatgpt-1") && (
                <div style={{ padding: "0 1rem 1rem 1rem" }}>
                  <p style={{ margin: "0 0 0.75rem 0", fontSize: "0.875rem", color: "#666" }}>
                    First, we need to enable this beta feature within ChatGPT.
                  </p>
                  <ol style={{ margin: 0, paddingLeft: "1.5rem", fontSize: "0.875rem", color: "#333", lineHeight: "1.6" }}>
                    <li>Open your ChatGPT interface and navigate to <strong>Settings</strong></li>
                    <li>Select the <strong>Connectors</strong> tab</li>
                    <li>Click on <strong>Advanced settings</strong></li>
                    <li>Toggle on <strong>Developer Mode</strong>. This unlocks the options for creating custom connectors.</li>
                  </ol>
                </div>
              )}
            </div>

            <div style={{ 
              background: "#f5f7fa", 
              borderRadius: "8px", 
              border: "1px solid #e0e0e0",
              overflow: "hidden"
            }}>
              <button
                onClick={() => toggleStep("chatgpt-2")}
                style={{
                  width: "100%",
                  padding: "1rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ fontSize: "1rem", fontWeight: 600, color: "#1a1a1a" }}>
                  Step 2: Create a Custom Connector
                </span>
                <svg 
                  style={{ 
                    width: "1.5rem", 
                    height: "1.5rem", 
                    transform: expandedSteps.has("chatgpt-2") ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.3s",
                    color: "#0052FF"
                  }} 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {expandedSteps.has("chatgpt-2") && (
                <div style={{ padding: "0 1rem 1rem 1rem" }}>
                  <p style={{ margin: "0 0 0.75rem 0", fontSize: "0.875rem", color: "#666" }}>
                    Once Developer Mode is enabled, you have the option to create custom connectors.
                  </p>
                  <ol style={{ margin: 0, paddingLeft: "1.5rem", fontSize: "0.875rem", color: "#333", lineHeight: "1.6" }}>
                    <li>In the Connectors settings, click on <strong>Create</strong></li>
                    <li>Provide the information for your MCP server:
                      <ul style={{ marginTop: "0.5rem", paddingLeft: "1.5rem" }}>
                        <li><strong>Name:</strong> Oops!402 (or any descriptive name)</li>
                        <li><strong>Description</strong> (Optional): Unlock commerce for AI agents with x402 wallet, discovery, and payment tools</li>
                        <li><strong>Icon</strong> (Optional): Provide an icon for easy identification</li>
                        <li><strong>MCP server URL:</strong> <code style={{ 
                          padding: "0.25rem 0.5rem", 
                          background: "rgba(0, 82, 255, 0.1)", 
                          borderRadius: "4px", 
                          color: "#0052FF",
                          fontSize: "0.8rem"
                        }}>{mcpServerUrl}</code></li>
                      </ul>
                    </li>
                    <li>Make sure <strong>Authentication</strong> is set to <strong>"OAuth"</strong></li>
                    <li>Confirm that you trust this application by clicking the checkbox</li>
                    <li>Click <strong>Create</strong></li>
                  </ol>
                </div>
              )}
            </div>

            <div style={{ 
              background: "#f5f7fa", 
              borderRadius: "8px", 
              border: "1px solid #e0e0e0",
              overflow: "hidden"
            }}>
              <button
                onClick={() => toggleStep("chatgpt-3")}
                style={{
                  width: "100%",
                  padding: "1rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ fontSize: "1rem", fontWeight: 600, color: "#1a1a1a" }}>
                  Step 3: Connect and Use
                </span>
                <svg 
                  style={{ 
                    width: "1.5rem", 
                    height: "1.5rem", 
                    transform: expandedSteps.has("chatgpt-3") ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.3s",
                    color: "#0052FF"
                  }} 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {expandedSteps.has("chatgpt-3") && (
                <div style={{ padding: "0 1rem 1rem 1rem" }}>
                  <ol style={{ margin: 0, paddingLeft: "1.5rem", fontSize: "0.875rem", color: "#333", lineHeight: "1.6" }}>
                    <li>After creating the connector, click <strong>Connect</strong> to go through the OAuth authentication flow</li>
                    <li>Once connected, you can enable specific tools from the "Search and tools" menu</li>
                    <li>Start using Oops!402 tools in your conversations!</li>
                  </ol>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "claude" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div style={{ 
              background: "#f5f7fa", 
              borderRadius: "8px", 
              border: "1px solid #e0e0e0",
              overflow: "hidden"
            }}>
              <button
                onClick={() => toggleStep("claude-1")}
                style={{
                  width: "100%",
                  padding: "1rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ fontSize: "1rem", fontWeight: 600, color: "#1a1a1a" }}>
                  Step 1: Navigate to Connectors Settings
                </span>
                <svg 
                  style={{ 
                    width: "1.5rem", 
                    height: "1.5rem", 
                    transform: expandedSteps.has("claude-1") ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.3s",
                    color: "#0052FF"
                  }} 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {expandedSteps.has("claude-1") && (
                <div style={{ padding: "0 1rem 1rem 1rem" }}>
                  <ul style={{ margin: 0, paddingLeft: "1.5rem", fontSize: "0.875rem", color: "#333", lineHeight: "1.6" }}>
                    <li>Go to <strong>Settings &gt; Connectors</strong> (for Pro and Max plans)</li>
                    <li>Or <strong>Admin settings &gt; Connectors</strong> (for Team and Enterprise plans)</li>
                  </ul>
                </div>
              )}
            </div>

            <div style={{ 
              background: "#f5f7fa", 
              borderRadius: "8px", 
              border: "1px solid #e0e0e0",
              overflow: "hidden"
            }}>
              <button
                onClick={() => toggleStep("claude-2")}
                style={{
                  width: "100%",
                  padding: "1rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ fontSize: "1rem", fontWeight: 600, color: "#1a1a1a" }}>
                  Step 2: Add Custom Connector
                </span>
                <svg 
                  style={{ 
                    width: "1.5rem", 
                    height: "1.5rem", 
                    transform: expandedSteps.has("claude-2") ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.3s",
                    color: "#0052FF"
                  }} 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {expandedSteps.has("claude-2") && (
                <div style={{ padding: "0 1rem 1rem 1rem" }}>
                  <ol style={{ margin: 0, paddingLeft: "1.5rem", fontSize: "0.875rem", color: "#333", lineHeight: "1.6" }}>
                    <li>Locate the <strong>"Connectors"</strong> section</li>
                    <li>Click <strong>"Add custom connector"</strong> at the bottom of the section</li>
                    <li>Add your connector's remote MCP server URL: <code style={{ 
                      padding: "0.25rem 0.5rem", 
                      background: "rgba(0, 82, 255, 0.1)", 
                      borderRadius: "4px", 
                      color: "#0052FF",
                      fontSize: "0.8rem"
                    }}>{mcpServerUrl}</code></li>
                    <li>Optionally, click <strong>"Advanced settings"</strong> to specify an OAuth Client ID and OAuth Client Secret for your server</li>
                    <li>Finish configuring your connector by clicking <strong>"Add"</strong></li>
                  </ol>
                </div>
              )}
            </div>

            <div style={{ 
              background: "#f5f7fa", 
              borderRadius: "8px", 
              border: "1px solid #e0e0e0",
              overflow: "hidden"
            }}>
              <button
                onClick={() => toggleStep("claude-3")}
                style={{
                  width: "100%",
                  padding: "1rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ fontSize: "1rem", fontWeight: 600, color: "#1a1a1a" }}>
                  Step 3: Enable and Use
                </span>
                <svg 
                  style={{ 
                    width: "1.5rem", 
                    height: "1.5rem", 
                    transform: expandedSteps.has("claude-3") ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.3s",
                    color: "#0052FF"
                  }} 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {expandedSteps.has("claude-3") && (
                <div style={{ padding: "0 1rem 1rem 1rem" }}>
                  <ol style={{ margin: 0, paddingLeft: "1.5rem", fontSize: "0.875rem", color: "#333", lineHeight: "1.6" }}>
                    <li>Enable connectors via the <strong>"Search and tools"</strong> button on the lower left of your chat interface</li>
                    <li>For connectors that require authentication, click <strong>"Connect"</strong> to go through the authentication flow</li>
                    <li>After connecting, use the same menu to enable or disable specific tools made available by the server</li>
                    <li>Start using Oops!402 tools in your conversations!</li>
                  </ol>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

