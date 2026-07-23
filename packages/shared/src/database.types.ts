export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows Supabase client to instantiate with the correct result types.
  __InternalSupabase: {
    PostgrestVersion: "12"
  }
  public: {
    Tables: {
      vehicles: {
        Row: {
          color: string | null
          created_at: string
          id: string
          is_default: boolean
          make: string | null
          model: string | null
          plate: string | null
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          make?: string | null
          model?: string | null
          plate?: string | null
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          make?: string | null
          model?: string | null
          plate?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      device_tokens: {
        Row: {
          created_at: string
          device_type: string
          expo_push_token: string
          id: string
          is_active: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_type: string
          expo_push_token: string
          id?: string
          is_active?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_type?: string
          expo_push_token?: string
          id?: string
          is_active?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "device_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_queue: {
        Row: {
          body: string
          created_at: string
          data: Json | null
          error: string | null
          id: string
          sent: boolean | null
          sent_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          data?: Json | null
          error?: string | null
          id?: string
          sent?: boolean | null
          sent_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          data?: Json | null
          error?: string | null
          id?: string
          sent?: boolean | null
          sent_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_queue_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "notification_queue_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_locations: {
        Row: {
          accuracy: number | null
          heading: number | null
          id: string
          is_online: boolean
          lat: number
          lng: number
          operator_id: string
          speed: number | null
          updated_at: string
        }
        Insert: {
          accuracy?: number | null
          heading?: number | null
          id?: string
          is_online?: boolean
          lat: number
          lng: number
          operator_id: string
          speed?: number | null
          updated_at?: string
        }
        Update: {
          accuracy?: number | null
          heading?: number | null
          id?: string
          is_online?: boolean
          lat?: number
          lng?: number
          operator_id?: string
          speed?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "operator_locations_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: true
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "operator_locations_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_rules: {
        Row: {
          base_exit_fee: number
          created_at: string
          currency: string
          description: string | null
          id: string
          included_km: number
          is_active: boolean
          name: string
          price_per_km_heavy: number
          price_per_km_light: number
          updated_at: string
        }
        Insert: {
          base_exit_fee?: number
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          included_km?: number
          is_active?: boolean
          name?: string
          price_per_km_heavy?: number
          price_per_km_light?: number
          updated_at?: string
        }
        Update: {
          base_exit_fee?: number
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          included_km?: number
          is_active?: boolean
          name?: string
          price_per_km_heavy?: number
          price_per_km_light?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          dui_number: string | null
          email: string | null
          full_name: string
          id: string
          id_doc_path: string | null
          phone: string
          provider_id: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
          verification_status: string
        }
        Insert: {
          created_at?: string
          dui_number?: string | null
          email?: string | null
          full_name: string
          id: string
          id_doc_path?: string | null
          phone: string
          provider_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          verification_status?: string
        }
        Update: {
          created_at?: string
          dui_number?: string | null
          email?: string | null
          full_name?: string
          id?: string
          id_doc_path?: string | null
          phone?: string
          provider_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          verification_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_services: {
        Row: {
          created_at: string | null
          custom_price: number | null
          id: string
          is_available: boolean | null
          provider_id: string
          service_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          custom_price?: number | null
          id?: string
          is_available?: boolean | null
          provider_id: string
          service_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          custom_price?: number | null
          id?: string
          is_available?: boolean | null
          provider_id?: string
          service_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_services_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      providers: {
        Row: {
          address: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          tow_type_supported: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          tow_type_supported: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          tow_type_supported?: string
          updated_at?: string
        }
        Relationships: []
      }
      ratings: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          rated_operator_id: string
          rater_user_id: string
          request_id: string
          stars: number
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          rated_operator_id: string
          rater_user_id: string
          request_id: string
          stars: number
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          rated_operator_id?: string
          rater_user_id?: string
          request_id?: string
          stars?: number
        }
        Relationships: [
          {
            foreignKeyName: "ratings_rated_operator_id_fkey"
            columns: ["rated_operator_id"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "ratings_rated_operator_id_fkey"
            columns: ["rated_operator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_rater_user_id_fkey"
            columns: ["rater_user_id"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "ratings_rater_user_id_fkey"
            columns: ["rater_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      request_events: {
        Row: {
          actor_id: string
          actor_role: Database["public"]["Enums"]["user_role"]
          created_at: string
          event_type: Database["public"]["Enums"]["event_type"]
          id: string
          payload: Json | null
          request_id: string
        }
        Insert: {
          actor_id: string
          actor_role: Database["public"]["Enums"]["user_role"]
          created_at?: string
          event_type: Database["public"]["Enums"]["event_type"]
          id?: string
          payload?: Json | null
          request_id: string
        }
        Update: {
          actor_id?: string
          actor_role?: Database["public"]["Enums"]["user_role"]
          created_at?: string
          event_type?: Database["public"]["Enums"]["event_type"]
          id?: string
          payload?: Json | null
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "request_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      request_messages: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string
          request_id: string
          sender_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          request_id: string
          sender_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          request_id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_messages_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "request_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      service_requests: {
        Row: {
          activated_at: string | null
          assigned_at: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          created_at: string
          distance_operator_to_pickup_km: number | null
          distance_pickup_to_dropoff_km: number | null
          dropoff_address: string
          dropoff_lat: number
          dropoff_lng: number
          id: string
          incident_description: string | null
          incident_type: string
          notes: string | null
          operator_id: string | null
          pickup_address: string
          pickup_lat: number
          pickup_lng: number
          pin_hash: string
          price_breakdown: Json | null
          provider_id: string | null
          route_polyline: string | null
          service_details: Json | null
          service_type: string
          status: Database["public"]["Enums"]["request_status"]
          total_price: number | null
          tow_type: Database["public"]["Enums"]["tow_type"]
          updated_at: string
          user_id: string
          vehicle_color: string | null
          vehicle_doc_path: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_photo_url: string | null
          vehicle_plate: string | null
        }
        Insert: {
          activated_at?: string | null
          assigned_at?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          created_at?: string
          distance_operator_to_pickup_km?: number | null
          distance_pickup_to_dropoff_km?: number | null
          dropoff_address: string
          dropoff_lat: number
          dropoff_lng: number
          id?: string
          incident_description?: string | null
          incident_type: string
          notes?: string | null
          operator_id?: string | null
          pickup_address: string
          pickup_lat: number
          pickup_lng: number
          pin_hash: string
          price_breakdown?: Json | null
          provider_id?: string | null
          route_polyline?: string | null
          service_details?: Json | null
          service_type?: string
          status?: Database["public"]["Enums"]["request_status"]
          total_price?: number | null
          tow_type?: Database["public"]["Enums"]["tow_type"]
          updated_at?: string
          user_id: string
          vehicle_color?: string | null
          vehicle_doc_path?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_photo_url?: string | null
          vehicle_plate?: string | null
        }
        Update: {
          activated_at?: string | null
          assigned_at?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          created_at?: string
          distance_operator_to_pickup_km?: number | null
          distance_pickup_to_dropoff_km?: number | null
          dropoff_address?: string
          dropoff_lat?: number
          dropoff_lng?: number
          id?: string
          incident_description?: string | null
          incident_type?: string
          notes?: string | null
          operator_id?: string | null
          pickup_address?: string
          pickup_lat?: number
          pickup_lng?: number
          pin_hash?: string
          price_breakdown?: Json | null
          provider_id?: string | null
          route_polyline?: string | null
          service_details?: Json | null
          service_type?: string
          status?: Database["public"]["Enums"]["request_status"]
          total_price?: number | null
          tow_type?: Database["public"]["Enums"]["tow_type"]
          updated_at?: string
          user_id?: string
          vehicle_color?: string | null
          vehicle_doc_path?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_photo_url?: string | null
          vehicle_plate?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_requests_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "service_requests_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_requests_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "service_requests_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_requests_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "service_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      service_type_pricing: {
        Row: {
          base_price: number
          created_at: string | null
          currency: string
          description: string
          display_name: string
          extra_fee: number
          extra_fee_label: string | null
          icon: string
          id: string
          is_active: boolean
          requires_destination: boolean
          service_type: string
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          base_price?: number
          created_at?: string | null
          currency?: string
          description?: string
          display_name: string
          extra_fee?: number
          extra_fee_label?: string | null
          icon?: string
          id?: string
          is_active?: boolean
          requires_destination?: boolean
          service_type: string
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          base_price?: number
          created_at?: string | null
          currency?: string
          description?: string
          display_name?: string
          extra_fee?: number
          extra_fee_label?: string | null
          icon?: string
          id?: string
          is_active?: boolean
          requires_destination?: boolean
          service_type?: string
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      services: {
        Row: {
          base_price: number | null
          created_at: string | null
          currency: string | null
          description_en: string | null
          description_es: string | null
          extra_fee: number | null
          extra_fee_label: string | null
          icon: string | null
          id: string
          is_active: boolean | null
          name_en: string
          name_es: string
          requires_destination: boolean | null
          slug: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          base_price?: number | null
          created_at?: string | null
          currency?: string | null
          description_en?: string | null
          description_es?: string | null
          extra_fee?: number | null
          extra_fee_label?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name_en: string
          name_es: string
          requires_destination?: boolean | null
          slug: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          base_price?: number | null
          created_at?: string | null
          currency?: string | null
          description_en?: string | null
          description_es?: string | null
          extra_fee?: number | null
          extra_fee_label?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name_en?: string
          name_es?: string
          requires_destination?: boolean | null
          slug?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      operator_stats: {
        Row: {
          average_rating: number | null
          cancelled_services: number | null
          completed_services: number | null
          full_name: string | null
          operator_id: string | null
          total_ratings: number | null
          total_services: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_service_request: {
        Args: { p_request_id: string }
        Returns: {
          activated_at: string | null
          assigned_at: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          created_at: string
          distance_operator_to_pickup_km: number | null
          distance_pickup_to_dropoff_km: number | null
          dropoff_address: string
          dropoff_lat: number
          dropoff_lng: number
          id: string
          incident_description: string | null
          incident_type: string
          notes: string | null
          operator_id: string | null
          pickup_address: string
          pickup_lat: number
          pickup_lng: number
          pin_hash: string
          price_breakdown: Json | null
          provider_id: string | null
          route_polyline: string | null
          service_details: Json | null
          service_type: string
          status: Database["public"]["Enums"]["request_status"]
          total_price: number | null
          tow_type: Database["public"]["Enums"]["tow_type"]
          updated_at: string
          user_id: string
          vehicle_color: string | null
          vehicle_doc_path: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_photo_url: string | null
          vehicle_plate: string | null
        }
        SetofOptions: {
          from: "*"
          to: "service_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_set_operator_verification: {
        Args: { p_operator_id: string; p_status: string }
        Returns: undefined
      }
      assign_nearest_operator: {
        Args: { p_request_id: string }
        Returns: {
          activated_at: string | null
          assigned_at: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          created_at: string
          distance_operator_to_pickup_km: number | null
          distance_pickup_to_dropoff_km: number | null
          dropoff_address: string
          dropoff_lat: number
          dropoff_lng: number
          id: string
          incident_description: string | null
          incident_type: string
          notes: string | null
          operator_id: string | null
          pickup_address: string
          pickup_lat: number
          pickup_lng: number
          pin_hash: string
          price_breakdown: Json | null
          provider_id: string | null
          route_polyline: string | null
          service_details: Json | null
          service_type: string
          status: Database["public"]["Enums"]["request_status"]
          total_price: number | null
          tow_type: Database["public"]["Enums"]["tow_type"]
          updated_at: string
          user_id: string
          vehicle_color: string | null
          vehicle_doc_path: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_photo_url: string | null
          vehicle_plate: string | null
        }
        SetofOptions: {
          from: "*"
          to: "service_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_assign_request: {
        Args: { p_request_id: string; p_operator_id: string }
        Returns: {
          activated_at: string | null
          assigned_at: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          created_at: string
          distance_operator_to_pickup_km: number | null
          distance_pickup_to_dropoff_km: number | null
          dropoff_address: string
          dropoff_lat: number
          dropoff_lng: number
          id: string
          incident_description: string | null
          incident_type: string
          notes: string | null
          operator_id: string | null
          pickup_address: string
          pickup_lat: number
          pickup_lng: number
          pin_hash: string
          price_breakdown: Json | null
          provider_id: string | null
          route_polyline: string | null
          service_details: Json | null
          service_type: string
          status: Database["public"]["Enums"]["request_status"]
          total_price: number | null
          tow_type: Database["public"]["Enums"]["tow_type"]
          updated_at: string
          user_id: string
          vehicle_color: string | null
          vehicle_doc_path: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_photo_url: string | null
          vehicle_plate: string | null
        }
        SetofOptions: {
          from: "*"
          to: "service_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_cancel_request: {
        Args: { p_request_id: string }
        Returns: {
          activated_at: string | null
          assigned_at: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          created_at: string
          distance_operator_to_pickup_km: number | null
          distance_pickup_to_dropoff_km: number | null
          dropoff_address: string
          dropoff_lat: number
          dropoff_lng: number
          id: string
          incident_description: string | null
          incident_type: string
          notes: string | null
          operator_id: string | null
          pickup_address: string
          pickup_lat: number
          pickup_lng: number
          pin_hash: string
          price_breakdown: Json | null
          provider_id: string | null
          route_polyline: string | null
          service_details: Json | null
          service_type: string
          status: Database["public"]["Enums"]["request_status"]
          total_price: number | null
          tow_type: Database["public"]["Enums"]["tow_type"]
          updated_at: string
          user_id: string
          vehicle_color: string | null
          vehicle_doc_path: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_photo_url: string | null
          vehicle_plate: string | null
        }
        SetofOptions: {
          from: "*"
          to: "service_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_update_user_role:
        | {
            Args: {
              p_new_role: Database["public"]["Enums"]["user_role"]
              p_user_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_new_role: Database["public"]["Enums"]["user_role"]
              p_provider_id?: string
              p_user_id: string
            }
            Returns: Json
          }
      auth_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      calculate_price: {
        Args: {
          p_distance_km: number
          p_tow_type: Database["public"]["Enums"]["tow_type"]
        }
        Returns: Json
      }
      cancel_service_request: {
        Args: { p_reason: string; p_request_id: string }
        Returns: Json
      }
      complete_service_request: {
        Args: { p_distance_pickup_to_dropoff: number; p_request_id: string }
        Returns: {
          activated_at: string | null
          assigned_at: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          created_at: string
          distance_operator_to_pickup_km: number | null
          distance_pickup_to_dropoff_km: number | null
          dropoff_address: string
          dropoff_lat: number
          dropoff_lng: number
          id: string
          incident_description: string | null
          incident_type: string
          notes: string | null
          operator_id: string | null
          pickup_address: string
          pickup_lat: number
          pickup_lng: number
          pin_hash: string
          price_breakdown: Json | null
          provider_id: string | null
          route_polyline: string | null
          service_details: Json | null
          service_type: string
          status: Database["public"]["Enums"]["request_status"]
          total_price: number | null
          tow_type: Database["public"]["Enums"]["tow_type"]
          updated_at: string
          user_id: string
          vehicle_color: string | null
          vehicle_doc_path: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_photo_url: string | null
          vehicle_plate: string | null
        }
        SetofOptions: {
          from: "*"
          to: "service_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_request_event: {
        Args: {
          p_event_type: Database["public"]["Enums"]["event_type"]
          p_payload?: Json
          p_request_id: string
        }
        Returns: {
          actor_id: string
          actor_role: Database["public"]["Enums"]["user_role"]
          created_at: string
          event_type: Database["public"]["Enums"]["event_type"]
          id: string
          payload: Json | null
          request_id: string
        }
        SetofOptions: {
          from: "*"
          to: "request_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_service_request: {
        Args: {
          p_dropoff_address: string
          p_dropoff_lat: number
          p_dropoff_lng: number
          p_incident_type: string
          p_notes?: string
          p_pickup_address?: string
          p_pickup_lat?: number
          p_pickup_lng?: number
          p_service_details?: Json
          p_service_type?: string
          p_tow_type?: Database["public"]["Enums"]["tow_type"]
          p_vehicle_doc_path?: string
          p_vehicle_photo_url?: string
          p_vehicle_plate?: string
        }
        Returns: Json
      }
      get_active_pricing_rule: {
        Args: never
        Returns: {
          base_exit_fee: number
          created_at: string
          currency: string
          description: string | null
          id: string
          included_km: number
          is_active: boolean
          name: string
          price_per_km_heavy: number
          price_per_km_light: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "pricing_rules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_admin_dashboard_stats: { Args: never; Returns: Json }
      get_available_requests_for_operator: { Args: never; Returns: Json }
      get_request_audit_trail: { Args: { p_request_id: string }; Returns: Json }
      get_user_device_tokens: {
        Args: { p_user_id: string }
        Returns: {
          device_type: string
          expo_push_token: string
        }[]
      }
      hash_pin: { Args: { p_pin: string }; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      is_mop: { Args: never; Returns: boolean }
      is_operator: { Args: never; Returns: boolean }
      operator_cancel_request: {
        Args: { p_request_id: string }
        Returns: {
          activated_at: string | null
          assigned_at: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          created_at: string
          distance_operator_to_pickup_km: number | null
          distance_pickup_to_dropoff_km: number | null
          dropoff_address: string
          dropoff_lat: number
          dropoff_lng: number
          id: string
          incident_description: string | null
          incident_type: string
          notes: string | null
          operator_id: string | null
          pickup_address: string
          pickup_lat: number
          pickup_lng: number
          pin_hash: string
          price_breakdown: Json | null
          provider_id: string | null
          route_polyline: string | null
          service_details: Json | null
          service_type: string
          status: Database["public"]["Enums"]["request_status"]
          total_price: number | null
          tow_type: Database["public"]["Enums"]["tow_type"]
          updated_at: string
          user_id: string
          vehicle_color: string | null
          vehicle_doc_path: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_photo_url: string | null
          vehicle_plate: string | null
        }
        SetofOptions: {
          from: "*"
          to: "service_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rate_service: {
        Args: { p_comment?: string; p_request_id: string; p_stars: number }
        Returns: Json
      }
      register_device_token: {
        Args: { p_device_type: string; p_expo_push_token: string }
        Returns: {
          created_at: string
          device_type: string
          expo_push_token: string
          id: string
          is_active: boolean
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "device_tokens"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      send_message: {
        Args: { p_message: string; p_request_id: string }
        Returns: Json
      }
      set_active_pricing_rule: { Args: { p_rule_id: string }; Returns: Json }
      unregister_device_token: {
        Args: { p_expo_push_token: string }
        Returns: boolean
      }
      upsert_operator_location: {
        Args: { p_is_online?: boolean; p_lat: number; p_lng: number }
        Returns: Json
      }
      verify_pin: { Args: { p_hash: string; p_pin: string }; Returns: boolean }
      verify_pin_and_activate: {
        Args: { p_pin: string; p_request_id: string }
        Returns: {
          activated_at: string | null
          assigned_at: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          created_at: string
          distance_operator_to_pickup_km: number | null
          distance_pickup_to_dropoff_km: number | null
          dropoff_address: string
          dropoff_lat: number
          dropoff_lng: number
          id: string
          incident_description: string | null
          incident_type: string
          notes: string | null
          operator_id: string | null
          pickup_address: string
          pickup_lat: number
          pickup_lng: number
          pin_hash: string
          price_breakdown: Json | null
          provider_id: string | null
          route_polyline: string | null
          service_details: Json | null
          service_type: string
          status: Database["public"]["Enums"]["request_status"]
          total_price: number | null
          tow_type: Database["public"]["Enums"]["tow_type"]
          updated_at: string
          user_id: string
          vehicle_color: string | null
          vehicle_doc_path: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_photo_url: string | null
          vehicle_plate: string | null
        }
        SetofOptions: {
          from: "*"
          to: "service_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      verify_request_pin: {
        Args: { p_pin: string; p_request_id: string }
        Returns: Json
      }
    }
    Enums: {
      event_type:
        | "REQUEST_CREATED"
        | "OPERATOR_ACCEPTED"
        | "OPERATOR_EN_ROUTE"
        | "PIN_VERIFIED"
        | "STATUS_CHANGED"
        | "OPERATOR_CANCELLED"
        | "ADMIN_CANCELLED"
        | "USER_CANCELLED"
        | "PRICE_COMPUTED"
        | "MOP_NOTIFIED"
        | "MESSAGE_SENT"
        | "RATING_SUBMITTED"
      request_status:
        | "initiated"
        | "assigned"
        | "en_route"
        | "active"
        | "completed"
        | "cancelled"
      tow_type: "light" | "heavy"
      user_role: "USER" | "OPERATOR" | "ADMIN" | "MOP"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string | null
        }
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Relationships: []
      }
      buckets_analytics: {
        Row: {
          created_at: string
          deleted_at: string | null
          format: string
          id: string
          name: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      buckets_vectors: {
        Row: {
          created_at: string
          id: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      iceberg_namespaces: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          metadata: Json
          name: string
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          metadata?: Json
          name: string
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_namespaces_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
        ]
      }
      iceberg_tables: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          location: string
          name: string
          namespace_id: string
          remote_table_id: string | null
          shard_id: string | null
          shard_key: string | null
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          location: string
          name: string
          namespace_id: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          location?: string
          name?: string
          namespace_id?: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_tables_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iceberg_tables_namespace_id_fkey"
            columns: ["namespace_id"]
            isOneToOne: false
            referencedRelation: "iceberg_namespaces"
            referencedColumns: ["id"]
          },
        ]
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          bucket_id: string | null
          created_at: string | null
          id: string
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        Insert: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          metadata: Json | null
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      vector_indexes: {
        Row: {
          bucket_id: string
          created_at: string
          data_type: string
          dimension: number
          distance_metric: string
          id: string
          metadata_configuration: Json | null
          name: string
          updated_at: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          data_type: string
          dimension: number
          distance_metric: string
          id?: string
          metadata_configuration?: Json | null
          name: string
          updated_at?: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          data_type?: string
          dimension?: number
          distance_metric?: string
          id?: string
          metadata_configuration?: Json | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vector_indexes_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets_vectors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allow_any_operation: {
        Args: { expected_operations: string[] }
        Returns: boolean
      }
      allow_only_operation: {
        Args: { expected_operation: string }
        Returns: boolean
      }
      can_insert_object: {
        Args: { bucketid: string; metadata: Json; name: string; owner: string }
        Returns: undefined
      }
      extension: { Args: { name: string }; Returns: string }
      filename: { Args: { name: string }; Returns: string }
      foldername: { Args: { name: string }; Returns: string[] }
      get_common_prefix: {
        Args: { p_delimiter: string; p_key: string; p_prefix: string }
        Returns: string
      }
      get_size_by_bucket: {
        Args: never
        Returns: {
          bucket_id: string
          size: number
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
          prefix_param: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          _bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_token?: string
          prefix_param: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      operation: { Args: never; Returns: string }
      search: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_by_timestamp: {
        Args: {
          p_bucket_id: string
          p_level: number
          p_limit: number
          p_prefix: string
          p_sort_column: string
          p_sort_column_after: string
          p_sort_order: string
          p_start_after: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_v2: {
        Args: {
          bucket_name: string
          levels?: number
          limits?: number
          prefix: string
          sort_column?: string
          sort_column_after?: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
    }
    Enums: {
      buckettype: "STANDARD" | "ANALYTICS" | "VECTOR"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      event_type: [
        "REQUEST_CREATED",
        "OPERATOR_ACCEPTED",
        "OPERATOR_EN_ROUTE",
        "PIN_VERIFIED",
        "STATUS_CHANGED",
        "OPERATOR_CANCELLED",
        "ADMIN_CANCELLED",
        "USER_CANCELLED",
        "PRICE_COMPUTED",
        "MOP_NOTIFIED",
        "MESSAGE_SENT",
        "RATING_SUBMITTED",
      ],
      request_status: [
        "initiated",
        "assigned",
        "en_route",
        "active",
        "completed",
        "cancelled",
      ],
      tow_type: ["light", "heavy"],
      user_role: ["USER", "OPERATOR", "ADMIN", "MOP"],
    },
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const

