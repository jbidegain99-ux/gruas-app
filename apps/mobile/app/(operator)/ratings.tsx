import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Star, Award } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { BudiLogo, Card, LoadingSpinner } from '@/components/ui';
import { colors, typography, spacing, radii } from '@/theme';

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
  const insets = useSafeAreaInsets();
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

  const renderStars = (count: number, size: number = 16) => {
    return (
      <View style={styles.starsRow}>
        {[1, 2, 3, 4, 5].map(i => (
          <Star
            key={i}
            size={size}
            color={colors.accent[500]}
            fill={i <= count ? colors.accent[500] : 'transparent'}
            strokeWidth={1.5}
          />
        ))}
      </View>
    );
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
    return <LoadingSpinner fullScreen />;
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.l }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.headerTop}>
        <BudiLogo variant="icon" height={28} />
      </View>

      {/* Stats Card */}
      {stats && (
        <Card variant="elevated" padding="l">
          <View style={styles.mainStat}>
            <Text style={styles.averageRating}>
              {stats.averageRating > 0 ? stats.averageRating.toFixed(1) : '-'}
            </Text>
            {renderStars(Math.round(stats.averageRating), 24)}
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
                  <Star size={12} color={colors.accent[500]} fill={colors.accent[500]} strokeWidth={1.5} />
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
        </Card>
      )}

      {/* Ratings List */}
      <Text style={styles.sectionTitle}>Resenas Recientes</Text>

      {ratings.length === 0 ? (
        <Card variant="default" padding="l">
          <View style={styles.emptyState}>
            <Award size={56} color={colors.text.tertiary} strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>Sin calificaciones aun</Text>
            <Text style={styles.emptyText}>
              Las calificaciones de tus clientes apareceran aqui
            </Text>
          </View>
        </Card>
      ) : (
        ratings.map(rating => (
          <Card key={rating.id} variant="default" padding="m">
            <View style={styles.ratingHeader}>
              {renderStars(rating.stars, 18)}
              <Text style={styles.ratingDate}>{formatDate(rating.created_at)}</Text>
            </View>
            <Text style={styles.raterName}>{rating.rater_name || 'Cliente'}</Text>
            {rating.comment && (
              <Text style={styles.ratingComment}>{rating.comment}</Text>
            )}
          </Card>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.secondary,
  },
  content: {
    padding: spacing.l,
    paddingBottom: spacing.xxxxl,
    gap: spacing.m,
  },
  headerTop: {
    marginBottom: spacing.xs,
  },
  starsRow: {
    flexDirection: 'row',
    gap: 2,
  },
  mainStat: {
    alignItems: 'center',
    marginBottom: spacing.l,
  },
  averageRating: {
    fontFamily: typography.fonts.heading,
    fontSize: 56,
    color: colors.text.primary,
  },
  totalRatings: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
    marginTop: spacing.s,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.m,
    borderTopWidth: 1,
    borderTopColor: colors.border.light,
    marginBottom: spacing.m,
  },
  statItem: {
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
  },
  statValue: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h2,
    color: colors.text.primary,
  },
  statLabel: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
    marginTop: spacing.micro,
  },
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: colors.border.light,
  },
  distribution: {
    gap: spacing.xs,
  },
  distributionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  distributionStar: {
    width: 16,
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  distributionBarContainer: {
    flex: 1,
    height: 8,
    backgroundColor: colors.background.secondary,
    borderRadius: radii.s,
    overflow: 'hidden',
  },
  distributionBar: {
    height: '100%',
    backgroundColor: colors.accent[500],
    borderRadius: radii.s,
  },
  distributionCount: {
    width: 24,
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
    textAlign: 'right',
  },
  sectionTitle: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.h3,
    color: colors.text.primary,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.s,
  },
  emptyTitle: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.h3,
    color: colors.text.primary,
  },
  emptyText: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  ratingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  ratingDate: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.tertiary,
  },
  raterName: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.body,
    color: colors.text.primary,
  },
  ratingComment: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
    marginTop: spacing.xs,
    lineHeight: 20,
  },
});
