/**
 * Analytics types for tracking payments, searches, clicks, and impressions
 */

export interface PaymentData {
  payer_wallet: string;
  resource_url: string;
  amount: string;
  tx_hash: string;
  network: string;
  asset: string;
  timestamp?: Date;
}

export interface SearchAnalyticsData {
  keyword: string;
  result_count: number;
  session_id_hash: string;
  timestamp?: Date;
}

export interface ClickAnalyticsData {
  promotion_id: string;
  resource_url: string;
  session_id_hash: string;
  timestamp?: Date;
}

export interface ImpressionAnalyticsData {
  promotion_id: string;
  search_keyword?: string;
  session_id_hash: string;
  timestamp?: Date;
}

export interface PopularTool {
  resource_url: string;
  payment_count: number;
  total_volume: string;
  average_amount: string;
}

export interface TopKeyword {
  keyword: string;
  search_count: number;
}

export interface PaymentStats {
  total_volume: string;
  total_count: number;
  average_amount: string;
  top_resources: PopularTool[];
  trends?: Array<{ date: string; volume: string; count: number }>;
}

export interface MyPromotionsPerformance {
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

