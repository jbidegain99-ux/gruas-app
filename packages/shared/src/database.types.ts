export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      cases: {
        Row: {
          created_at: string
          folio: string
          id: string
          request_id: string
        }
        Insert: {
          created_at?: string
          folio: string
          id?: string
          request_id: string
        }
        Update: {
          created_at?: string
          folio?: string
          id?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cases_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_plans: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          insurer_id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          insurer_id: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          insurer_id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coverage_plans_insurer_id_fkey"
            columns: ["insurer_id"]
            isOneToOne: false
            referencedRelation: "insurers"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_rules: {
        Row: {
          created_at: string
          id: string
          plan_id: string
          rule_key: string
          rule_value: number | null
          service_type: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          plan_id: string
          rule_key: string
          rule_value?: number | null
          service_type?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          plan_id?: string
          rule_key?: string
          rule_value?: number | null
          service_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coverage_rules_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "coverage_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_usage: {
        Row: {
          amount_copay: number
          amount_covered: number
          created_at: string
          id: string
          km_used: number | null
          member_id: string
          request_id: string
          service_type: string
          used_on: string
        }
        Insert: {
          amount_copay?: number
          amount_covered?: number
          created_at?: string
          id?: string
          km_used?: number | null
          member_id: string
          request_id: string
          service_type: string
          used_on?: string
        }
        Update: {
          amount_copay?: number
          amount_covered?: number
          created_at?: string
          id?: string
          km_used?: number | null
          member_id?: string
          request_id?: string
          service_type?: string
          used_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "coverage_usage_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_usage_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
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
      insurer_api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          insurer_id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          insurer_id: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          insurer_id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "insurer_api_keys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "insurer_api_keys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurer_api_keys_insurer_id_fkey"
            columns: ["insurer_id"]
            isOneToOne: false
            referencedRelation: "insurers"
            referencedColumns: ["id"]
          },
        ]
      }
      insurers: {
        Row: {
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          sla_arrival_minutes: number
          sla_assignment_minutes: number
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sla_arrival_minutes?: number
          sla_assignment_minutes?: number
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sla_arrival_minutes?: number
          sla_assignment_minutes?: number
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      members: {
        Row: {
          created_at: string
          document_number: string
          ends_on: string | null
          full_name: string
          id: string
          is_active: boolean
          phone: string | null
          policy_id: string
          profile_id: string | null
          relationship: string
          starts_on: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          document_number: string
          ends_on?: string | null
          full_name: string
          id?: string
          is_active?: boolean
          phone?: string | null
          policy_id: string
          profile_id?: string | null
          relationship?: string
          starts_on?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          document_number?: string
          ends_on?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          phone?: string | null
          policy_id?: string
          profile_id?: string | null
          relationship?: string
          starts_on?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "members_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "members_profile_id_fkey"
            columns: ["profile_id"]
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
      operator_documents: {
        Row: {
          bucket: string
          doc_type: string
          id: string
          operator_id: string
          path: string
          uploaded_at: string
        }
        Insert: {
          bucket: string
          doc_type: string
          id?: string
          operator_id: string
          path: string
          uploaded_at?: string
        }
        Update: {
          bucket?: string
          doc_type?: string
          id?: string
          operator_id?: string
          path?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "operator_documents_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "operator_documents_operator_id_fkey"
            columns: ["operator_id"]
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
      pin_attempts: {
        Row: {
          attempted_at: string
          id: string
          operator_id: string
          request_id: string
          success: boolean
        }
        Insert: {
          attempted_at?: string
          id?: string
          operator_id: string
          request_id: string
          success: boolean
        }
        Update: {
          attempted_at?: string
          id?: string
          operator_id?: string
          request_id?: string
          success?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "pin_attempts_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      policies: {
        Row: {
          created_at: string
          ends_on: string | null
          holder_name: string
          id: string
          insurer_id: string
          plan_id: string
          policy_number: string
          starts_on: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ends_on?: string | null
          holder_name: string
          id?: string
          insurer_id: string
          plan_id: string
          policy_number: string
          starts_on: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ends_on?: string | null
          holder_name?: string
          id?: string
          insurer_id?: string
          plan_id?: string
          policy_number?: string
          starts_on?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "policies_insurer_id_fkey"
            columns: ["insurer_id"]
            isOneToOne: false
            referencedRelation: "insurers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policies_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "coverage_plans"
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
      profile_sensitive: {
        Row: {
          dui_number: string | null
          id_doc_path: string | null
          profile_id: string
          updated_at: string
        }
        Insert: {
          dui_number?: string | null
          id_doc_path?: string | null
          profile_id: string
          updated_at?: string
        }
        Update: {
          dui_number?: string | null
          id_doc_path?: string | null
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_sensitive_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "profile_sensitive_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          id: string
          marketing_opt_in: boolean
          phone: string
          privacy_accepted_at: string | null
          provider_id: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
          verification_rejection_reason: string | null
          verification_reviewed_at: string | null
          verification_reviewed_by: string | null
          verification_status: string
          verification_submitted_at: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name: string
          id: string
          marketing_opt_in?: boolean
          phone: string
          privacy_accepted_at?: string | null
          provider_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          verification_rejection_reason?: string | null
          verification_reviewed_at?: string | null
          verification_reviewed_by?: string | null
          verification_status?: string
          verification_submitted_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          marketing_opt_in?: boolean
          phone?: string
          privacy_accepted_at?: string | null
          provider_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          verification_rejection_reason?: string | null
          verification_reviewed_at?: string | null
          verification_reviewed_by?: string | null
          verification_status?: string
          verification_submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_verification_reviewed_by_fkey"
            columns: ["verification_reviewed_by"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "profiles_verification_reviewed_by_fkey"
            columns: ["verification_reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
            referencedRelation: "service_type_pricing"
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
          business_type: string
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          tow_type_supported: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          business_type?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          tow_type_supported?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          business_type?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          tow_type_supported?: string | null
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
      service_location_trail: {
        Row: {
          id: number
          lat: number
          lng: number
          recorded_at: string
          request_id: string
        }
        Insert: {
          id?: number
          lat: number
          lng: number
          recorded_at?: string
          request_id: string
        }
        Update: {
          id?: number
          lat?: number
          lng?: number
          recorded_at?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_location_trail_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
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
          coverage_status: string | null
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
          pool_alerted_at: string | null
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
          coverage_status?: string | null
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
          pool_alerted_at?: string | null
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
          coverage_status?: string | null
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
          pool_alerted_at?: string | null
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
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "vehicles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      service_type_pricing: {
        Row: {
          base_price: number | null
          created_at: string | null
          currency: string | null
          description: string | null
          display_name: string | null
          extra_fee: number | null
          extra_fee_label: string | null
          icon: string | null
          id: string | null
          is_active: boolean | null
          requires_destination: boolean | null
          service_type: string | null
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          base_price?: number | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          display_name?: string | null
          extra_fee?: number | null
          extra_fee_label?: string | null
          icon?: string | null
          id?: string | null
          is_active?: boolean | null
          requires_destination?: boolean | null
          service_type?: string | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          base_price?: number | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          display_name?: string | null
          extra_fee?: number | null
          extra_fee_label?: string | null
          icon?: string | null
          id?: string | null
          is_active?: boolean | null
          requires_destination?: boolean | null
          service_type?: string | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _import_members: {
        Args: { p_members: Json; p_policy_id: string }
        Returns: Json
      }
      accept_service_request: {
        Args: { p_request_id: string }
        Returns: {
          activated_at: string | null
          assigned_at: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          coverage_status: string | null
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
          pool_alerted_at: string | null
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
        Args: { p_operator_id: string; p_request_id: string }
        Returns: {
          activated_at: string | null
          assigned_at: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          coverage_status: string | null
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
          pool_alerted_at: string | null
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
          coverage_status: string | null
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
          pool_alerted_at: string | null
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
        Args: { p_operator_id: string; p_reason?: string; p_status: string }
        Returns: undefined
      }
      admin_update_user_role: {
        Args: {
          p_new_role: Database["public"]["Enums"]["user_role"]
          p_provider_id?: string
          p_user_id: string
        }
        Returns: Json
      }
      alert_stale_pool_requests: { Args: never; Returns: undefined }
      assign_nearest_operator: {
        Args: { p_request_id: string }
        Returns: {
          activated_at: string | null
          assigned_at: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          coverage_status: string | null
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
          pool_alerted_at: string | null
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
      check_member_coverage: { Args: never; Returns: Json }
      complete_service_request: {
        Args: { p_distance_pickup_to_dropoff: number; p_request_id: string }
        Returns: {
          activated_at: string | null
          assigned_at: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          coverage_status: string | null
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
          pool_alerted_at: string | null
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
      coverage_rule_lookup: {
        Args: { p_plan_id: string; p_rule_key: string; p_service_type: string }
        Returns: {
          alcance: string
          existe: boolean
          valor: number
        }[]
      }
      create_insurer_api_key: {
        Args: { p_insurer_id: string; p_name: string }
        Returns: Json
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
      drain_notification_queue: { Args: never; Returns: undefined }
      evaluate_coverage: {
        Args: {
          p_exclude_request?: string
          p_km?: number
          p_member_id: string
          p_service_type: string
          p_total: number
          p_tow_type?: Database["public"]["Enums"]["tow_type"]
        }
        Returns: Json
      }
      generate_secure_pin: { Args: never; Returns: string }
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
      get_case_sla: { Args: { p_folio: string }; Returns: Json }
      get_case_timeline: {
        Args: { p_folio: string }
        Returns: {
          actor_role: string
          at: string
          detail: string
          event_type: string
          label: string
        }[]
      }
      get_request_audit_trail: { Args: { p_request_id: string }; Returns: Json }
      get_user_device_tokens: {
        Args: { p_user_id: string }
        Returns: {
          device_type: string
          expo_push_token: string
        }[]
      }
      hash_pin: { Args: { p_pin: string }; Returns: string }
      id_documents_frozen: { Args: never; Returns: boolean }
      import_members_for_insurer: {
        Args: { p_insurer_id: string; p_members: Json; p_policy_number: string }
        Returns: Json
      }
      import_policy_members: {
        Args: { p_members: Json; p_policy_id: string }
        Returns: Json
      }
      is_admin: { Args: never; Returns: boolean }
      is_my_insurer: { Args: { p_insurer_id: string }; Returns: boolean }
      is_my_plan: { Args: { p_plan_id: string }; Returns: boolean }
      is_my_policy: { Args: { p_policy_id: string }; Returns: boolean }
      is_operator: { Args: never; Returns: boolean }
      member_document_key: { Args: { p_doc: string }; Returns: string }
      next_case_folio: { Args: never; Returns: string }
      normalize_document: { Args: { p_doc: string }; Returns: string }
      operator_cancel_request: {
        Args: { p_request_id: string }
        Returns: {
          activated_at: string | null
          assigned_at: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          coverage_status: string | null
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
          pool_alerted_at: string | null
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
      preview_my_coverage: {
        Args: {
          p_km?: number
          p_service_type: string
          p_total: number
          p_tow_type?: Database["public"]["Enums"]["tow_type"]
        }
        Returns: Json
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
      revoke_insurer_api_key: { Args: { p_key_id: string }; Returns: undefined }
      send_message: {
        Args: { p_message: string; p_request_id: string }
        Returns: Json
      }
      set_active_pricing_rule: { Args: { p_rule_id: string }; Returns: Json }
      set_marketing_opt_in: { Args: { p_value: boolean }; Returns: undefined }
      submit_operator_verification: { Args: never; Returns: undefined }
      unregister_device_token: {
        Args: { p_expo_push_token: string }
        Returns: boolean
      }
      upsert_operator_document: {
        Args: { p_bucket: string; p_doc_type: string; p_path: string }
        Returns: undefined
      }
      upsert_operator_location: {
        Args: { p_is_online?: boolean; p_lat: number; p_lng: number }
        Returns: Json
      }
      verify_insurer_api_key: { Args: { p_key: string }; Returns: string }
      verify_pin: { Args: { p_hash: string; p_pin: string }; Returns: boolean }
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
        | "MESSAGE_SENT"
        | "RATING_SUBMITTED"
        | "COVERAGE_CHECKED"
        | "PRICE_DISTANCE_CAPPED"
      request_status:
        | "initiated"
        | "assigned"
        | "en_route"
        | "active"
        | "completed"
        | "cancelled"
      tow_type: "light" | "heavy"
      user_role: "USER" | "OPERATOR" | "ADMIN"
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
        "MESSAGE_SENT",
        "RATING_SUBMITTED",
        "COVERAGE_CHECKED",
        "PRICE_DISTANCE_CAPPED",
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
      user_role: ["USER", "OPERATOR", "ADMIN"],
    },
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const

