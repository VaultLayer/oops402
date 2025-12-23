/**
 * Analytics Service
 * Tracks payments, searches, clicks, and impressions for analytics
 */

import { getSupabaseClient } from '../shared/supabase.js';
import { logger } from '../shared/logger.js';
import type {
  PaymentData,
  SearchAnalyticsData,
  ClickAnalyticsData,
  ImpressionAnalyticsData,
  PopularTool,
  TopKeyword,
  PaymentStats,
  MyPromotionsPerformance,
} from './types.js';

// Lazy initialization of Supabase client to handle cases where it's not configured
let supabaseClient: ReturnType<typeof getSupabaseClient> | null = null;

function getSupabase() {
  if (!supabaseClient) {
    try {
      supabaseClient = getSupabaseClient();
    } catch (error) {
      logger.warning('Supabase not configured for analytics', {
        error: (error as Error).message,
      });
      return null;
    }
  }
  return supabaseClient;
}

/**
 * Track ALL payments processed through the system
 */
export async function trackPayment(data: PaymentData): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) {
    logger.debug('Skipping payment tracking - Supabase not configured');
    return null;
  }

  try {
    const { data: payment, error } = await supabase
      .from('oops402_payments')
      .insert({
        payer_wallet: data.payer_wallet.toLowerCase(),
        resource_url: data.resource_url,
        amount: data.amount,
        tx_hash: data.tx_hash,
        network: data.network,
        asset: data.asset.toLowerCase(),
        timestamp: data.timestamp || new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      // If it's a duplicate tx_hash error, that's okay - payment already tracked
      if (error.code === '23505') {
        logger.debug('Payment already tracked', { tx_hash: data.tx_hash });
        return null;
      }
      throw error;
    }

    logger.debug('Payment tracked', { payment_id: payment.id, tx_hash: data.tx_hash });
    return payment.id;
  } catch (error) {
    logger.error('Failed to track payment', error as Error, { tx_hash: data.tx_hash });
    return null;
  }
}

/**
 * Link a payment to a promotion for promotion-specific analytics
 */
export async function linkPaymentToPromotion(
  promotionId: string,
  paymentId: string
): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) {
    logger.debug('Skipping payment-to-promotion linking - Supabase not configured');
    return false;
  }

  try {
    const { error } = await supabase
      .from('oops402_promotion_payments')
      .insert({
        promotion_id: promotionId,
        payment_id: paymentId,
      });

    if (error) {
      // If it's a duplicate, that's okay
      if (error.code === '23505') {
        return true;
      }
      throw error;
    }

    return true;
  } catch (error) {
    logger.error('Failed to link payment to promotion', error as Error, {
      promotionId,
      paymentId,
    });
    return false;
  }
}

/**
 * Track search queries
 */
export async function trackSearch(data: SearchAnalyticsData): Promise<void> {
  logger.debug('trackSearch called', {
    keyword: data.keyword,
    result_count: data.result_count,
    has_session_id_hash: !!data.session_id_hash,
  });
  
  const supabase = getSupabase();
  if (!supabase) {
    logger.warning('Skipping search tracking - Supabase not configured', {
      keyword: data.keyword,
    });
    return;
  }

  try {
    // session_id_hash is already hashed when passed in
    logger.debug('Inserting search analytics', {
      keyword: data.keyword,
      result_count: data.result_count,
    });
    
    const { error } = await supabase
      .from('oops402_search_analytics')
      .insert({
        keyword: data.keyword,
        result_count: data.result_count,
        session_id_hash: data.session_id_hash, // Already hashed
        timestamp: data.timestamp || new Date().toISOString(),
      });

    if (error) {
      logger.error('Failed to track search - Supabase error', error as Error, { 
        keyword: data.keyword,
        error_code: error.code,
        error_message: error.message,
        error_details: error.details,
        error_hint: error.hint,
      });
      throw error;
    }

    logger.info('Search tracked successfully', { 
      keyword: data.keyword,
      result_count: data.result_count,
    });
  } catch (error) {
    logger.error('Failed to track search', error as Error, { 
      keyword: data.keyword,
      error_type: (error as Error).constructor.name,
    });
    throw error; // Re-throw so caller knows it failed
  }
}

/**
 * Track clicks on promoted results
 */
export async function trackPromotedClick(data: ClickAnalyticsData): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) {
    logger.debug('Skipping click tracking - Supabase not configured');
    return;
  }

  try {
    // session_id_hash is already hashed when passed in
    const { error } = await supabase
      .from('oops402_click_analytics')
      .insert({
        promotion_id: data.promotion_id,
        resource_url: data.resource_url,
        session_id_hash: data.session_id_hash, // Already hashed
        timestamp: data.timestamp || new Date().toISOString(),
      });

    if (error) throw error;

    logger.debug('Promoted click tracked', { promotion_id: data.promotion_id });
  } catch (error) {
    logger.error('Failed to track promoted click', error as Error, {
      promotion_id: data.promotion_id,
    });
  }
}

/**
 * Track impressions (when promoted result is shown in search)
 */
export async function trackPromotedImpression(data: ImpressionAnalyticsData): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) {
    logger.debug('Skipping impression tracking - Supabase not configured');
    return;
  }

  try {
    // session_id_hash is already hashed when passed in
    const { error } = await supabase
      .from('oops402_promotion_impressions')
      .insert({
        promotion_id: data.promotion_id,
        search_keyword: data.search_keyword || null,
        session_id_hash: data.session_id_hash, // Already hashed
        timestamp: data.timestamp || new Date().toISOString(),
      });

    if (error) throw error;

    logger.debug('Promoted impression tracked', { promotion_id: data.promotion_id });
  } catch (error) {
    logger.error('Failed to track promoted impression', error as Error, {
      promotion_id: data.promotion_id,
    });
  }
}

/**
 * Get popular tools by payment volume
 */
export async function getPopularTools(
  limit: number = 10,
  timeframeDays?: number
): Promise<PopularTool[]> {
  const supabase = getSupabase();
  if (!supabase) {
    logger.debug('Skipping getPopularTools - Supabase not configured');
    return [];
  }

  try {
    let query = supabase
      .from('oops402_payments')
      .select('resource_url, amount')
      .order('timestamp', { ascending: false });

    if (timeframeDays) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - timeframeDays);
      query = query.gte('timestamp', cutoffDate.toISOString());
    }

    const { data: payments, error } = await query;

    if (error) throw error;
    if (!payments) return [];

    // Aggregate by resource_url
    const resourceMap = new Map<string, { count: number; total: bigint }>();
    
    for (const payment of payments) {
      const url = payment.resource_url;
      const amount = BigInt(payment.amount);
      
      const existing = resourceMap.get(url) || { count: 0, total: 0n };
      resourceMap.set(url, {
        count: existing.count + 1,
        total: existing.total + amount,
      });
    }

    // Convert to array and sort by total volume
    const tools: PopularTool[] = Array.from(resourceMap.entries())
      .map(([resource_url, stats]) => ({
        resource_url,
        payment_count: stats.count,
        total_volume: stats.total.toString(),
        average_amount: (stats.total / BigInt(stats.count)).toString(),
      }))
      .sort((a, b) => {
        const aTotal = BigInt(a.total_volume);
        const bTotal = BigInt(b.total_volume);
        return aTotal > bTotal ? -1 : aTotal < bTotal ? 1 : 0;
      })
      .slice(0, limit);

    return tools;
  } catch (error) {
    logger.error('Failed to get popular tools', error as Error);
    return [];
  }
}

/**
 * Get top searched keywords
 */
export async function getTopKeywords(
  limit: number = 10,
  timeframeDays?: number
): Promise<TopKeyword[]> {
  const supabase = getSupabase();
  if (!supabase) {
    logger.debug('Skipping getTopKeywords - Supabase not configured');
    return [];
  }

  try {
    let query = supabase
      .from('oops402_search_analytics')
      .select('keyword')
      .order('timestamp', { ascending: false });

    if (timeframeDays) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - timeframeDays);
      query = query.gte('timestamp', cutoffDate.toISOString());
    }

    const { data: searches, error } = await query;

    if (error) throw error;
    if (!searches) return [];

    // Count keyword occurrences
    const keywordMap = new Map<string, number>();
    for (const search of searches) {
      const keyword = search.keyword.toLowerCase().trim();
      if (keyword) {
        keywordMap.set(keyword, (keywordMap.get(keyword) || 0) + 1);
      }
    }

    // Convert to array and sort by count
    const keywords: TopKeyword[] = Array.from(keywordMap.entries())
      .map(([keyword, search_count]) => ({ keyword, search_count }))
      .sort((a, b) => b.search_count - a.search_count)
      .slice(0, limit);

    return keywords;
  } catch (error) {
    logger.error('Failed to get top keywords', error as Error);
    return [];
  }
}

/**
 * Get overall payment statistics
 */
export async function getPaymentStats(timeframeDays?: number): Promise<PaymentStats> {
  const supabase = getSupabase();
  if (!supabase) {
    logger.debug('Skipping getPaymentStats - Supabase not configured');
    return {
      total_volume: '0',
      total_count: 0,
      average_amount: '0',
      top_resources: [],
    };
  }

  try {
    let query = supabase
      .from('oops402_payments')
      .select('amount, resource_url, timestamp');

    if (timeframeDays) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - timeframeDays);
      query = query.gte('timestamp', cutoffDate.toISOString());
    }

    const { data: payments, error } = await query;

    if (error) throw error;
    if (!payments || payments.length === 0) {
      return {
        total_volume: '0',
        total_count: 0,
        average_amount: '0',
        top_resources: [],
      };
    }

    // Calculate stats
    let totalVolume = 0n;
    for (const payment of payments) {
      totalVolume += BigInt(payment.amount);
    }

    const totalCount = payments.length;
    const averageAmount = totalCount > 0 ? (totalVolume / BigInt(totalCount)).toString() : '0';

    // Get top resources
    const topResources = await getPopularTools(10, timeframeDays);

    return {
      total_volume: totalVolume.toString(),
      total_count: totalCount,
      average_amount: averageAmount,
      top_resources: topResources,
    };
  } catch (error) {
    logger.error('Failed to get payment stats', error as Error);
    return {
      total_volume: '0',
      total_count: 0,
      average_amount: '0',
      top_resources: [],
    };
  }
}

/**
 * Get aggregated performance metrics for all user's promotions
 */
export async function getMyPromotionsPerformance(
  walletAddress: string,
  timeframeDays?: number
): Promise<MyPromotionsPerformance> {
  const supabase = getSupabase();
  if (!supabase) {
    logger.debug('Skipping getMyPromotionsPerformance - Supabase not configured');
    return {
      total_clicks: 0,
      total_impressions: 0,
      average_ctr: 0,
      total_payments_received: 0,
      total_revenue: '0',
      average_conversion_rate: 0,
      top_performing_promotions: [],
    };
  }

  try {
    const walletLower = walletAddress.toLowerCase();

    // Get user's promotions
    let promotionsQuery = supabase
      .from('oops402_promotions')
      .select('id')
      .eq('promoted_by_wallet', walletLower);

    const { data: promotions, error: promotionsError } = await promotionsQuery;

    if (promotionsError) throw promotionsError;
    if (!promotions || promotions.length === 0) {
      return {
        total_clicks: 0,
        total_impressions: 0,
        average_ctr: 0,
        total_payments_received: 0,
        total_revenue: '0',
        average_conversion_rate: 0,
        top_performing_promotions: [],
      };
    }

    const promotionIds = promotions.map((p) => p.id);

    // Get clicks
    let clicksQuery = supabase
      .from('oops402_click_analytics')
      .select('promotion_id')
      .in('promotion_id', promotionIds);

    if (timeframeDays) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - timeframeDays);
      clicksQuery = clicksQuery.gte('timestamp', cutoffDate.toISOString());
    }

    const { data: clicks, error: clicksError } = await clicksQuery;
    if (clicksError) throw clicksError;

    // Get impressions
    let impressionsQuery = supabase
      .from('oops402_promotion_impressions')
      .select('promotion_id')
      .in('promotion_id', promotionIds);

    if (timeframeDays) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - timeframeDays);
      impressionsQuery = impressionsQuery.gte('timestamp', cutoffDate.toISOString());
    }

    const { data: impressions, error: impressionsError } = await impressionsQuery;
    if (impressionsError) throw impressionsError;

    // Get payments
    let paymentsQuery = supabase
      .from('oops402_promotion_payments')
      .select('promotion_id, payment_id, oops402_payments!inner(amount)')
      .in('promotion_id', promotionIds);

    const { data: promotionPayments, error: paymentsError } = await paymentsQuery;
    if (paymentsError) throw paymentsError;

    const totalClicks = clicks?.length || 0;
    const totalImpressions = impressions?.length || 0;
    const averageCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

    // Calculate revenue from payments
    let totalRevenue = 0n;
    const paymentsReceived = promotionPayments?.length || 0;
    if (promotionPayments) {
      for (const pp of promotionPayments) {
        const payment = (pp as any).oops402_payments;
        // Handle both array and object cases from Supabase join
        const paymentData = Array.isArray(payment) ? payment[0] : payment;
        if (paymentData && typeof paymentData === 'object' && 'amount' in paymentData && paymentData.amount) {
          totalRevenue += BigInt(paymentData.amount);
        }
      }
    }

    const averageConversionRate =
      totalClicks > 0 ? (paymentsReceived / totalClicks) * 100 : 0;

    // Get top performing promotions
    const clicksByPromotion = new Map<string, number>();
    const paymentsByPromotion = new Map<string, number>();
    const revenueByPromotion = new Map<string, bigint>();

    if (clicks) {
      for (const click of clicks) {
        clicksByPromotion.set(
          click.promotion_id,
          (clicksByPromotion.get(click.promotion_id) || 0) + 1
        );
      }
    }

    if (promotionPayments) {
      for (const pp of promotionPayments) {
        const promotionId = pp.promotion_id;
        paymentsByPromotion.set(
          promotionId,
          (paymentsByPromotion.get(promotionId) || 0) + 1
        );

        const payment = (pp as any).oops402_payments;
        // Handle both array and object cases from Supabase join
        const paymentData = Array.isArray(payment) ? payment[0] : payment;
        if (paymentData && typeof paymentData === 'object' && 'amount' in paymentData && paymentData.amount) {
          revenueByPromotion.set(
            promotionId,
            (revenueByPromotion.get(promotionId) || 0n) + BigInt(paymentData.amount)
          );
        }
      }
    }

    // Get promotion details for top performers
    const { data: promotionDetails, error: detailsError } = await supabase
      .from('oops402_promotions')
      .select('id, resource_url')
      .in('id', promotionIds);

    if (detailsError) throw detailsError;

    const topPerforming = (promotionDetails || [])
      .map((promo) => ({
        promotion_id: promo.id,
        resource_url: promo.resource_url,
        clicks: clicksByPromotion.get(promo.id) || 0,
        payments_received: paymentsByPromotion.get(promo.id) || 0,
        revenue: (revenueByPromotion.get(promo.id) || 0n).toString(),
      }))
      .sort((a, b) => {
        // Sort by revenue, then clicks
        const aRev = BigInt(a.revenue);
        const bRev = BigInt(b.revenue);
        if (aRev !== bRev) {
          return aRev > bRev ? -1 : 1;
        }
        return b.clicks - a.clicks;
      })
      .slice(0, 10);

    return {
      total_clicks: totalClicks,
      total_impressions: totalImpressions,
      average_ctr: averageCtr,
      total_payments_received: paymentsReceived,
      total_revenue: totalRevenue.toString(),
      average_conversion_rate: averageConversionRate,
      top_performing_promotions: topPerforming,
    };
  } catch (error) {
    logger.error('Failed to get my promotions performance', error as Error, { walletAddress });
    return {
      total_clicks: 0,
      total_impressions: 0,
      average_ctr: 0,
      total_payments_received: 0,
      total_revenue: '0',
      average_conversion_rate: 0,
      top_performing_promotions: [],
    };
  }
}

