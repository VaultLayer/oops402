import { useState, useEffect } from "react";
import { styles } from "../styles";
import { checkAuthError } from "../utils/auth";
import { formatAmountDisplay } from "../utils/formatting";

interface AnalyticsSectionProps {
  walletAddress: string;
}

interface Promotion {
  id: string;
  resource_url: string;
  agent_id?: string;
  status: string;
  start_date: string;
  end_date?: string;
  payment_amount: string;
  stats?: {
    clicks: number;
    impressions: number;
    ctr: number;
    payments_received: number;
    revenue: string;
  };
}

interface MyPromotionsPerformance {
  total_clicks: number;
  total_impressions: number;
  average_ctr: number;
  total_payments_received: number;
  total_revenue: string;
  average_conversion_rate: number;
  top_performing_promotions: Array<{
    promotion_id: string;
    resource_url: string;
    clicks: number;
    payments_received: number;
    revenue: string;
  }>;
}

interface PopularTool {
  resource_url: string;
  payment_count: number;
  total_volume: string;
  average_amount: string;
}

interface TopKeyword {
  keyword: string;
  search_count: number;
}

interface PaymentStats {
  total_volume: string;
  total_count: number;
  average_amount: string;
  top_resources: PopularTool[];
}

export function AnalyticsSection({ walletAddress }: AnalyticsSectionProps) {
  const [activeView, setActiveView] = useState<"my-promotions" | "global-trends">("global-trends");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // My Promotions data
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [performance, setPerformance] = useState<MyPromotionsPerformance | null>(null);
  
  // Global Trends data
  const [topKeywords, setTopKeywords] = useState<TopKeyword[]>([]);
  const [popularTools, setPopularTools] = useState<PopularTool[]>([]);
  const [paymentStats, setPaymentStats] = useState<PaymentStats | null>(null);
  
  const [timeframe, setTimeframe] = useState<number | undefined>(30); // days

  useEffect(() => {
    if (activeView === "my-promotions") {
      loadMyPromotions();
      loadPerformance();
    } else {
      loadGlobalTrends();
    }
  }, [activeView, timeframe]);

  const loadMyPromotions = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/promotions/my", {
        credentials: "include",
      });
      
      if (await checkAuthError(response)) {
        return;
      }
      
      if (!response.ok) {
        throw new Error("Failed to load promotions");
      }
      
      const data = await response.json();
      setPromotions(data.promotions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load promotions");
    } finally {
      setLoading(false);
    }
  };

  const loadPerformance = async () => {
    try {
      const params = new URLSearchParams();
      if (timeframe) {
        params.append("timeframe", timeframe.toString());
      }
      
      const response = await fetch(`/api/analytics/my-promotions-performance?${params.toString()}`, {
        credentials: "include",
      });
      
      if (await checkAuthError(response)) {
        return;
      }
      
      if (!response.ok) {
        throw new Error("Failed to load performance");
      }
      
      const data = await response.json();
      setPerformance(data.performance);
    } catch (err) {
      console.error("Failed to load performance", err);
    }
  };

  const loadGlobalTrends = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (timeframe) {
        params.append("timeframe", timeframe.toString());
      }
      
      // Load all global trends data
      const [keywordsRes, toolsRes, statsRes] = await Promise.all([
        fetch(`/api/analytics/keywords?${params.toString()}`, { credentials: "include" }),
        fetch(`/api/analytics/popular-tools?${params.toString()}`, { credentials: "include" }),
        fetch(`/api/analytics/payment-stats?${params.toString()}`, { credentials: "include" }),
      ]);

      if (await checkAuthError(keywordsRes) || await checkAuthError(toolsRes) || await checkAuthError(statsRes)) {
        return;
      }

      if (!keywordsRes.ok) {
        const errorData = await keywordsRes.json().catch(() => ({}));
        throw new Error(errorData.message || `Failed to load keywords: ${keywordsRes.statusText}`);
      }
      if (!toolsRes.ok) {
        const errorData = await toolsRes.json().catch(() => ({}));
        throw new Error(errorData.message || `Failed to load tools: ${toolsRes.statusText}`);
      }
      if (!statsRes.ok) {
        const errorData = await statsRes.json().catch(() => ({}));
        throw new Error(errorData.message || `Failed to load stats: ${statsRes.statusText}`);
      }

      const keywordsData = await keywordsRes.json();
      const toolsData = await toolsRes.json();
      const statsData = await statsRes.json();

      console.log('Analytics data loaded:', { keywordsData, toolsData, statsData });

      setTopKeywords(keywordsData.keywords || []);
      setPopularTools(toolsData.tools || []);
      setPaymentStats(statsData.stats);
    } catch (err) {
      console.error('Failed to load global trends', err);
      setError(err instanceof Error ? err.message : "Failed to load global trends");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.section}>
      <div style={styles.sectionHeader}>
        <h2 style={styles.sectionTitle}>Analytics</h2>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <select
            value={timeframe || ""}
            onChange={(e) => setTimeframe(e.target.value ? Number(e.target.value) : undefined)}
            style={styles.input}
            className="input"
          >
            <option value="">All Time</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </div>
      </div>

      <div style={{ marginBottom: "1rem", display: "flex", gap: "0.5rem" }}>
        <button
          onClick={() => setActiveView("global-trends")}
          style={{
            ...styles.buttonSecondary,
            ...(activeView === "global-trends" ? { background: "#0052FF", color: "white" } : {}),
          }}
          className="button-secondary"
        >
          Global Trends
        </button>
        <button
          onClick={() => setActiveView("my-promotions")}
          style={{
            ...styles.buttonSecondary,
            ...(activeView === "my-promotions" ? { background: "#0052FF", color: "white" } : {}),
          }}
          className="button-secondary"
        >
          My Promotions
        </button>
      </div>

      {loading && <div style={styles.loadingText}>Loading...</div>}
      {error && <div style={styles.errorText}>{error}</div>}

      {activeView === "my-promotions" && (
        <div>
          {performance && (
            <div style={styles.discoveryCard}>
              <h3 style={styles.discoveryCardSubtitle}>Overall Performance</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
                <div>
                  <div style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>Total Clicks</div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{performance.total_clicks}</div>
                </div>
                <div>
                  <div style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>Total Impressions</div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{performance.total_impressions}</div>
                </div>
                <div>
                  <div style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>Average CTR</div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{performance.average_ctr.toFixed(2)}%</div>
                </div>
                <div>
                  <div style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>Total Revenue</div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#00D4A1" }}>
                    {formatAmountDisplay(performance.total_revenue)} USDC
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>Payments Received</div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{performance.total_payments_received}</div>
                </div>
                <div>
                  <div style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>Conversion Rate</div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{performance.average_conversion_rate.toFixed(2)}%</div>
                </div>
              </div>
            </div>
          )}

          {performance && performance.top_performing_promotions.length > 0 && (
            <div style={styles.discoveryCard}>
              <h3 style={styles.discoveryCardSubtitle}>Top Performing Promotions</h3>
              <div style={styles.discoveryList}>
                {performance.top_performing_promotions.map((promo) => (
                  <div key={promo.promotion_id} style={styles.discoveryCard}>
                    <div style={styles.discoveryCardHeader}>
                      <div style={styles.discoveryCardInfo}>
                        <div style={styles.discoveryResourceUrl}>{promo.resource_url}</div>
                      </div>
                      <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                        <div>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Clicks</div>
                          <div style={{ fontWeight: 700 }}>{promo.clicks}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Revenue</div>
                          <div style={{ fontWeight: 700, color: "#00D4A1" }}>
                            {formatAmountDisplay(promo.revenue)} USDC
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Payments</div>
                          <div style={{ fontWeight: 700 }}>{promo.payments_received}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={styles.discoveryCard}>
            <h3 style={styles.discoveryCardSubtitle}>All Promotions</h3>
            {promotions.length === 0 ? (
              <div style={styles.emptyText}>No promotions found</div>
            ) : (
              <div style={styles.discoveryList}>
                {promotions.map((promo) => (
                  <div key={promo.id} style={styles.discoveryCard}>
                    <div style={styles.discoveryCardHeader}>
                      <div style={styles.discoveryCardInfo}>
                        <div style={styles.discoveryResourceUrl}>{promo.resource_url}</div>
                        <div style={{ fontSize: "0.875rem", color: "var(--text-secondary)", marginTop: "0.25rem" }}>
                          Status: {promo.status} | Started: {new Date(promo.start_date).toLocaleDateString()}
                        </div>
                      </div>
                      {promo.stats && (
                        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                          <div>
                            <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Clicks</div>
                            <div style={{ fontWeight: 700 }}>{promo.stats.clicks}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>CTR</div>
                            <div style={{ fontWeight: 700 }}>{promo.stats.ctr.toFixed(2)}%</div>
                          </div>
                          <div>
                            <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Revenue</div>
                            <div style={{ fontWeight: 700, color: "#00D4A1" }}>
                              {formatAmountDisplay(promo.stats.revenue)} USDC
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeView === "global-trends" && (
        <div>
          {paymentStats && (
            <div style={styles.discoveryCard}>
              <h3 style={styles.discoveryCardSubtitle}>Overall Payment Statistics</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
                <div>
                  <div style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>Total Volume</div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#00D4A1" }}>
                    {formatAmountDisplay(paymentStats.total_volume)} USDC
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>Total Payments</div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{paymentStats.total_count}</div>
                </div>
                <div>
                  <div style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>Average Amount</div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
                    {formatAmountDisplay(paymentStats.average_amount)} USDC
                  </div>
                </div>
              </div>
            </div>
          )}

          <div style={styles.discoveryCard}>
            <h3 style={styles.discoveryCardSubtitle}>Most Popular Tools</h3>
            {popularTools.length > 0 ? (
              <div style={styles.discoveryList}>
                {popularTools.map((tool, index) => (
                  <div key={tool.resource_url} style={styles.discoveryCard}>
                    <div style={styles.discoveryCardHeader}>
                      <div style={styles.discoveryCardInfo}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <span style={{ ...styles.badge, width: "24px", height: "24px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            #{index + 1}
                          </span>
                          <div style={styles.discoveryResourceUrl}>{tool.resource_url}</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                        <div>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Payments</div>
                          <div style={{ fontWeight: 700 }}>{tool.payment_count}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Total Volume</div>
                          <div style={{ fontWeight: 700, color: "#00D4A1" }}>
                            {formatAmountDisplay(tool.total_volume)} USDC
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Avg Amount</div>
                          <div style={{ fontWeight: 700 }}>
                            {formatAmountDisplay(tool.average_amount)} USDC
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={styles.emptyText}>No payment data available yet</div>
            )}
          </div>

          <div style={styles.discoveryCard}>
            <h3 style={styles.discoveryCardSubtitle}>Top Searched Keywords</h3>
            {topKeywords.length > 0 ? (
              <div style={styles.discoveryList}>
                {topKeywords.map((keyword, index) => (
                  <div key={keyword.keyword} style={styles.discoveryCard}>
                    <div style={styles.discoveryCardHeader}>
                      <div style={styles.discoveryCardInfo}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <span style={{ ...styles.badge, width: "24px", height: "24px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            #{index + 1}
                          </span>
                          <div style={{ fontSize: "1rem", fontWeight: 600 }}>{keyword.keyword}</div>
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Search Count</div>
                        <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{keyword.search_count}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={styles.emptyText}>No search data available yet. Try searching for resources!</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

