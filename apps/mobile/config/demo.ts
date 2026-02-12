/**
 * Demo Mode Configuration
 * Enables GPS movement simulation for development/demo purposes.
 * Auto-enabled in __DEV__ mode, completely disabled in production.
 */

export const DEMO_CONFIG = {
  /** Auto-enable in development builds */
  ENABLED: false,

  /** Simulation speed multiplier (2x = 12 min trip becomes 6 min) */
  SIMULATION_SPEED: 2.0,

  /** How often to update simulated operator position (ms) */
  UPDATE_INTERVAL_MS: 2000,

  /** Average city driving speed for simulation (km/h) */
  AVERAGE_SPEED_KMH: 30,

  /** Distance threshold to consider operator "arrived" (km) */
  ARRIVAL_THRESHOLD_KM: 0.05, // 50 meters
} as const;
