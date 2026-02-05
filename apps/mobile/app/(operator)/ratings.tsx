import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { supabase } from '@/lib/supabase';

type Rating = {
  id: string;
  stars: number;
  comment: string | null;
  created_at: string;
  rater_name: string | null;
};

type OperatorStats = {
  averageRating: number;
  totalRatings: number;
  totalCompleted: number;
  starCounts: Record<number, number>;
};

export default function OperatorRatings() {
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [stats, setStats] = useState<OperatorStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchRatings = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Fetch ratings
    const { data: ratingsData, error: ratingsError } = await supabase
      .from('ratings')
      .select(`
        id,
        stars,
        comment,
        created_at,
        rater:profiles!ratings_rater_user_id_fkey (full_name)
      `)
      .eq('rated_operator_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (ratingsError) {
      console.error('Error fetching ratings:', ratingsError);
    } else if (ratingsData) {
      setRatings(ratingsData.map(r => ({
        id: r.id,
        stars: r.stars,
        comment: r.comment,
        created_at: r.created_at,
        rater_name: (r.rater as unknown as { full_name: string } | null)?.full_name || null,
      })));
    }

    // Calculate stats
    const { data: allRatings } = await supabase
      .from('ratings')
      .select('stars')
      .eq('rated_operator_id', user.id);

    const { count: completedCount } = await supabase
      .from('service_requests')
      .select('*', { count: 'exact', head: true })
      .eq('operator_id', user.id)
      .eq('status', 'completed');

    if (allRatings) {
      const starCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      let total = 0;

      allRatings.forEach(r => {
        starCounts[r.stars] = (starCounts[r.stars] || 0) + 1;
        total += r.stars;
      });

      setStats({
        averageRating: allRatings.length > 0 ? total / allRatings.length : 0,
        totalRatings: allRatings.length,
        totalCompleted: completedCount || 0,
        starCounts,
      });
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRatings();
  }, [fetchRatings]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchRatings();
    setRefreshing(false);
  };

  const renderStars = (count: number) => {
    return '★'.repeat(count) + '☆'.repeat(5 - count);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#16a34a" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Stats Card */}
      {stats && (
        <View style={styles.statsCard}>
          <View style={styles.mainStat}>
            <Text style={styles.averageRating}>
              {stats.averageRating > 0 ? stats.averageRating.toFixed(1) : '-'}
            </Text>
            <Text style={styles.starsDisplay}>
              {renderStars(Math.round(stats.averageRating))}
            </Text>
            <Text style={styles.totalRatings}>
              {stats.totalRatings} calificacion{stats.totalRatings !== 1 ? 'es' : ''}
            </Text>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats.totalCompleted}</Text>
              <Text style={styles.statLabel}>Servicios</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats.totalRatings}</Text>
              <Text style={styles.statLabel}>Resenas</Text>
            </View>
          </View>

          {/* Star Distribution */}
          <View style={styles.distribution}>
            {[5, 4, 3, 2, 1].map(star => {
              const count = stats.starCounts[star] || 0;
              const percentage = stats.totalRatings > 0
                ? (count / stats.totalRatings) * 100
                : 0;

              return (
                <View key={star} style={styles.distributionRow}>
                  <Text style={styles.distributionStar}>{star}</Text>
                  <View style={styles.distributionBarContainer}>
                    <View
                      style={[
                        styles.distributionBar,
                        { width: `${percentage}%` }
                      ]}
                    />
                  </View>
                  <Text style={styles.distributionCount}>{count}</Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* Ratings List */}
      <Text style={styles.sectionTitle}>Resenas Recientes</Text>

      {ratings.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>⭐</Text>
          <Text style={styles.emptyTitle}>Sin calificaciones aun</Text>
          <Text style={styles.emptyText}>
            Las calificaciones de tus clientes apareceran aqui
          </Text>
        </View>
      ) : (
        ratings.map(rating => (
          <View key={rating.id} style={styles.ratingCard}>
            <View style={styles.ratingHeader}>
              <Text style={styles.ratingStars}>{renderStars(rating.stars)}</Text>
              <Text style={styles.ratingDate}>{formatDate(rating.created_at)}</Text>
            </View>
            <Text style={styles.raterName}>{rating.rater_name || 'Cliente'}</Text>
            {rating.comment && (
              <Text style={styles.ratingComment}>{rating.comment}</Text>
            )}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
  },
  statsCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  mainStat: {
    alignItems: 'center',
    marginBottom: 20,
  },
  averageRating: {
    fontSize: 56,
    fontWeight: 'bold',
    color: '#111827',
  },
  starsDisplay: {
    fontSize: 24,
    color: '#f59e0b',
    marginTop: 4,
  },
  totalRatings: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 8,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    marginBottom: 16,
  },
  statItem: {
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '600',
    color: '#111827',
  },
  statLabel: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#e5e7eb',
  },
  distribution: {
    gap: 8,
  },
  distributionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  distributionStar: {
    width: 16,
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
  },
  distributionBarContainer: {
    flex: 1,
    height: 8,
    backgroundColor: '#f3f4f6',
    borderRadius: 4,
    overflow: 'hidden',
  },
  distributionBar: {
    height: '100%',
    backgroundColor: '#f59e0b',
    borderRadius: 4,
  },
  distributionCount: {
    width: 24,
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'right',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 12,
  },
  emptyState: {
    alignItems: 'center',
    padding: 40,
    backgroundColor: '#fff',
    borderRadius: 16,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
  },
  ratingCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  ratingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  ratingStars: {
    fontSize: 18,
    color: '#f59e0b',
  },
  ratingDate: {
    fontSize: 13,
    color: '#9ca3af',
  },
  raterName: {
    fontSize: 15,
    fontWeight: '500',
    color: '#111827',
  },
  ratingComment: {
    fontSize: 14,
    color: '#4b5563',
    marginTop: 8,
    lineHeight: 20,
  },
});
