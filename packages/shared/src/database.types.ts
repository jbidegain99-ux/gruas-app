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
      account_deletions: {
        Row: {
          deleted_at: string
          files_removed_at: string | null
          role: string
          user_id: string
        }
        Insert: {
          deleted_at?: string
          files_removed_at?: string | null
          role: string
          user_id: string
        }
        Update: {
          deleted_at?: string
          files_removed_at?: string | null
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      account_statement_lines: {
        Row: {
          amount: number
          completed_at: string
          copay: number | null
          fee: number
          folio: string | null
          provider_id: string | null
          provider_kind: string | null
          provider_name: string | null
          request_id: string
          service_type: string
          statement_id: string
          total_km: number | null
          tow_km: number | null
        }
        Insert: {
          amount: number
          completed_at: string
          copay?: number | null
          fee?: number
          folio?: string | null
          provider_id?: string | null
          provider_kind?: string | null
          provider_name?: string | null
          request_id: string
          service_type: string
          statement_id: string
          total_km?: number | null
          tow_km?: number | null
        }
        Update: {
          amount?: number
          completed_at?: string
          copay?: number | null
          fee?: number
          folio?: string | null
          provider_id?: string | null
          provider_kind?: string | null
          provider_name?: string | null
          request_id?: string
          service_type?: string
          statement_id?: string
          total_km?: number | null
          tow_km?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "account_statement_lines_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_statement_lines_statement_id_fkey"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "account_statements"
            referencedColumns: ["id"]
          },
        ]
      }
      account_statements: {
        Row: {
          approved_amount: number | null
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          id: string
          issued_at: string | null
          issued_by: string | null
          number: string | null
          organization_id: string
          paid_at: string | null
          paid_by: string | null
          paid_reference: string | null
          period_from: string
          period_to: string
          status: string
          void_reason: string | null
        }
        Insert: {
          approved_amount?: number | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          number?: string | null
          organization_id: string
          paid_at?: string | null
          paid_by?: string | null
          paid_reference?: string | null
          period_from: string
          period_to: string
          status?: string
          void_reason?: string | null
        }
        Update: {
          approved_amount?: number | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          number?: string | null
          organization_id?: string
          paid_at?: string | null
          paid_by?: string | null
          paid_reference?: string | null
          period_from?: string
          period_to?: string
          status?: string
          void_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_statements_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "account_statements_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_statements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "account_statements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_statements_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "account_statements_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_statements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_statements_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "account_statements_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_release_policy: {
        Row: {
          latest_version: string
          min_version: string
          platform: string
          store_url: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          latest_version?: string
          min_version?: string
          platform: string
          store_url?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          latest_version?: string
          min_version?: string
          platform?: string
          store_url?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_release_policy_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "app_release_policy_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string
          actor_name: string | null
          actor_role: string | null
          changes: Json
          id: number
          occurred_at: string
          record_id: string | null
          record_label: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id: string
          actor_name?: string | null
          actor_role?: string | null
          changes: Json
          id?: never
          occurred_at?: string
          record_id?: string | null
          record_label?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string
          actor_name?: string | null
          actor_role?: string | null
          changes?: Json
          id?: never
          occurred_at?: string
          record_id?: string | null
          record_label?: string | null
          table_name?: string
        }
        Relationships: []
      }
      cases: {
        Row: {
          approach_km: number | null
          created_at: string
          declared_km: number | null
          folio: string
          id: string
          km_computed_at: string | null
          request_id: string
          tow_km: number | null
          trail_points: number | null
          vehicle_id: string | null
          vehicle_plate: string | null
        }
        Insert: {
          approach_km?: number | null
          created_at?: string
          declared_km?: number | null
          folio: string
          id?: string
          km_computed_at?: string | null
          request_id: string
          tow_km?: number | null
          trail_points?: number | null
          vehicle_id?: string | null
          vehicle_plate?: string | null
        }
        Update: {
          approach_km?: number | null
          created_at?: string
          declared_km?: number | null
          folio?: string
          id?: string
          km_computed_at?: string | null
          request_id?: string
          tow_km?: number | null
          trail_points?: number | null
          vehicle_id?: string | null
          vehicle_plate?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cases_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "operator_vehicles"
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
      dte_settings: {
        Row: {
          ambiente: string
          cod_estable: string
          cod_punto_venta: string
          emisor: Json
          id: number
          prices_include_iva: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ambiente?: string
          cod_estable?: string
          cod_punto_venta?: string
          emisor?: Json
          id?: number
          prices_include_iva?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ambiente?: string
          cod_estable?: string
          cod_punto_venta?: string
          emisor?: Json
          id?: number
          prices_include_iva?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dte_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "dte_settings_updated_by_fkey"
            columns: ["updated_by"]
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
          expires_at: string | null
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
          expires_at?: string | null
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
          expires_at?: string | null
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
      insurer_webhooks: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          events: string[]
          id: string
          insurer_id: string
          is_active: boolean
          secret: string
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          events: string[]
          id?: string
          insurer_id: string
          is_active?: boolean
          secret: string
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          events?: string[]
          id?: string
          insurer_id?: string
          is_active?: boolean
          secret?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "insurer_webhooks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "insurer_webhooks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurer_webhooks_insurer_id_fkey"
            columns: ["insurer_id"]
            isOneToOne: false
            referencedRelation: "insurers"
            referencedColumns: ["id"]
          },
        ]
      }
      insurers: {
        Row: {
          brand_color: string | null
          brand_enabled: boolean
          brand_logo_path: string | null
          brand_name: string | null
          brand_updated_at: string | null
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
          brand_color?: string | null
          brand_enabled?: boolean
          brand_logo_path?: string | null
          brand_name?: string | null
          brand_updated_at?: string | null
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
          brand_color?: string | null
          brand_enabled?: boolean
          brand_logo_path?: string | null
          brand_name?: string | null
          brand_updated_at?: string | null
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
      ledger_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string
          id: string
          note: string | null
          paid_on: string
          payee_id: string | null
          payee_kind: string
          payer_id: string | null
          payer_kind: string
          reference: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by: string
          id?: string
          note?: string | null
          paid_on: string
          payee_id?: string | null
          payee_kind: string
          payer_id?: string | null
          payer_kind: string
          reference?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string
          id?: string
          note?: string | null
          paid_on?: string
          payee_id?: string | null
          payee_kind?: string
          payer_id?: string | null
          payer_kind?: string
          reference?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: []
      }
      members: {
        Row: {
          created_at: string
          deactivated_at: string | null
          deactivated_by: string | null
          deactivation_reason: string | null
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
          deactivated_at?: string | null
          deactivated_by?: string | null
          deactivation_reason?: string | null
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
          deactivated_at?: string | null
          deactivated_by?: string | null
          deactivation_reason?: string | null
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
            foreignKeyName: "members_deactivated_by_fkey"
            columns: ["deactivated_by"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "members_deactivated_by_fkey"
            columns: ["deactivated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
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
      mopt_reports: {
        Row: {
          email_status: string | null
          emailed_at: string | null
          emailed_to: string[] | null
          generated_at: string
          id: string
          month: string
          provider_id: string
          report: Json
        }
        Insert: {
          email_status?: string | null
          emailed_at?: string | null
          emailed_to?: string[] | null
          generated_at?: string
          id?: string
          month: string
          provider_id: string
          report: Json
        }
        Update: {
          email_status?: string | null
          emailed_at?: string | null
          emailed_to?: string[] | null
          generated_at?: string
          id?: string
          month?: string
          provider_id?: string
          report?: Json
        }
        Relationships: [
          {
            foreignKeyName: "mopt_reports_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      mopt_zones: {
        Row: {
          active_days: number[] | null
          created_at: string
          hours_from: string | null
          hours_to: string | null
          id: string
          is_active: boolean
          name: string
          polygon: Json
          provider_id: string
          service_types: string[] | null
          updated_at: string
        }
        Insert: {
          active_days?: number[] | null
          created_at?: string
          hours_from?: string | null
          hours_to?: string | null
          id?: string
          is_active?: boolean
          name: string
          polygon: Json
          provider_id: string
          service_types?: string[] | null
          updated_at?: string
        }
        Update: {
          active_days?: number[] | null
          created_at?: string
          hours_from?: string | null
          hours_to?: string | null
          id?: string
          is_active?: boolean
          name?: string
          polygon?: Json
          provider_id?: string
          service_types?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mopt_zones_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
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
          expires_on: string | null
          expiry_warned_at: string | null
          id: string
          operator_id: string
          path: string
          review_note: string | null
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          uploaded_at: string
        }
        Insert: {
          bucket: string
          doc_type: string
          expires_on?: string | null
          expiry_warned_at?: string | null
          id?: string
          operator_id: string
          path: string
          review_note?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          uploaded_at?: string
        }
        Update: {
          bucket?: string
          doc_type?: string
          expires_on?: string | null
          expiry_warned_at?: string | null
          id?: string
          operator_id?: string
          path?: string
          review_note?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
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
      operator_profiles: {
        Row: {
          bank_account_holder: string | null
          bank_account_number: string | null
          bank_account_type: string | null
          bank_name: string | null
          created_at: string
          dui_number: string | null
          nit: string | null
          operator_id: string
          service_types: string[] | null
          updated_at: string
        }
        Insert: {
          bank_account_holder?: string | null
          bank_account_number?: string | null
          bank_account_type?: string | null
          bank_name?: string | null
          created_at?: string
          dui_number?: string | null
          nit?: string | null
          operator_id: string
          service_types?: string[] | null
          updated_at?: string
        }
        Update: {
          bank_account_holder?: string | null
          bank_account_number?: string | null
          bank_account_type?: string | null
          bank_name?: string | null
          created_at?: string
          dui_number?: string | null
          nit?: string | null
          operator_id?: string
          service_types?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "operator_profiles_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: true
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "operator_profiles_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_vehicles: {
        Row: {
          capacity_m3: number | null
          created_at: string
          id: string
          is_active: boolean
          operator_id: string
          plate: string
          updated_at: string
          vehicle_type: string
        }
        Insert: {
          capacity_m3?: number | null
          created_at?: string
          id?: string
          is_active?: boolean
          operator_id: string
          plate: string
          updated_at?: string
          vehicle_type?: string
        }
        Update: {
          capacity_m3?: number | null
          created_at?: string
          id?: string
          is_active?: boolean
          operator_id?: string
          plate?: string
          updated_at?: string
          vehicle_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "operator_vehicles_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "operator_vehicles_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      org_budget_alerts: {
        Row: {
          consumed: number
          created_at: string
          month: string
          organization_id: string
          threshold: number
        }
        Insert: {
          consumed: number
          created_at?: string
          month: string
          organization_id: string
          threshold: number
        }
        Update: {
          consumed?: number
          created_at?: string
          month?: string
          organization_id?: string
          threshold?: number
        }
        Relationships: [
          {
            foreignKeyName: "org_budget_alerts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_onboarding: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          notes: string | null
          organization_id: string
          started_at: string
          started_by: string | null
          test_input: Json | null
          test_passed_at: string | null
          test_result: Json | null
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          notes?: string | null
          organization_id: string
          started_at?: string
          started_by?: string | null
          test_input?: Json | null
          test_passed_at?: string | null
          test_result?: Json | null
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          notes?: string | null
          organization_id?: string
          started_at?: string
          started_by?: string | null
          test_input?: Json | null
          test_passed_at?: string | null
          test_result?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "org_onboarding_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "org_onboarding_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_onboarding_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_onboarding_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "org_onboarding_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_contracts: {
        Row: {
          monthly_cap: number | null
          on_cap: string
          organization_id: string
          reference: string | null
          tariff_notes: string | null
          updated_at: string
          updated_by: string | null
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          monthly_cap?: number | null
          on_cap?: string
          organization_id: string
          reference?: string | null
          tariff_notes?: string | null
          updated_at?: string
          updated_by?: string | null
          valid_from: string
          valid_to?: string | null
        }
        Update: {
          monthly_cap?: number | null
          on_cap?: string
          organization_id?: string
          reference?: string | null
          tariff_notes?: string | null
          updated_at?: string
          updated_by?: string | null
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_contracts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_contracts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "organization_contracts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_fiscal_data: {
        Row: {
          dte_type: string
          organization_id: string
          receptor: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          dte_type?: string
          organization_id: string
          receptor?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          dte_type?: string
          organization_id?: string
          receptor?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_fiscal_data_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_fiscal_data_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "organization_fiscal_data_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          invited_by_name: string | null
          organization_id: string
          revoked_at: string | null
          role: string
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          invited_by_name?: string | null
          organization_id: string
          revoked_at?: string | null
          role: string
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          invited_by_name?: string | null
          organization_id?: string
          revoked_at?: string | null
          role?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          added_by: string | null
          created_at: string
          organization_id: string
          profile_id: string
          role: string
          status: string
          updated_at: string
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          organization_id: string
          profile_id: string
          role?: string
          status?: string
          updated_at?: string
        }
        Update: {
          added_by?: string | null
          created_at?: string
          organization_id?: string
          profile_id?: string
          role?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "organization_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          insurer_id: string | null
          name: string
          parent_id: string | null
          provider_id: string | null
          sla_arrival_minutes: number | null
          sla_assignment_minutes: number | null
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          insurer_id?: string | null
          name: string
          parent_id?: string | null
          provider_id?: string | null
          sla_arrival_minutes?: number | null
          sla_assignment_minutes?: number | null
          status?: string
          type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          insurer_id?: string | null
          name?: string
          parent_id?: string | null
          provider_id?: string | null
          sla_arrival_minutes?: number | null
          sla_assignment_minutes?: number | null
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_insurer_id_fkey"
            columns: ["insurer_id"]
            isOneToOne: true
            referencedRelation: "insurers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: true
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      outbound_messages: {
        Row: {
          body: string
          channel: string
          created_at: string
          id: string
          lead_id: string | null
          sent_at: string | null
          sent_by: string | null
          status: string
          subject: string | null
          to_address: string
        }
        Insert: {
          body: string
          channel: string
          created_at?: string
          id?: string
          lead_id?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          subject?: string | null
          to_address: string
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string
          id?: string
          lead_id?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          subject?: string | null
          to_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbound_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "partner_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_leads: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          id: string
          notes: string | null
          phone: string
          profile_id: string | null
          service_types: string[]
          status: string
          updated_at: string
          vehicle_type: string | null
          zone: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          notes?: string | null
          phone: string
          profile_id?: string | null
          service_types?: string[]
          status?: string
          updated_at?: string
          vehicle_type?: string | null
          zone?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          notes?: string | null
          phone?: string
          profile_id?: string | null
          service_types?: string[]
          status?: string
          updated_at?: string
          vehicle_type?: string | null
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_leads_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "partner_leads_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_batches: {
        Row: {
          created_at: string
          created_by: string | null
          cutoff: string
          id: string
          number: string | null
          paid_at: string | null
          paid_by: string | null
          paid_on: string | null
          receipt_path: string | null
          reference: string | null
          status: string
          void_reason: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          cutoff: string
          id?: string
          number?: string | null
          paid_at?: string | null
          paid_by?: string | null
          paid_on?: string | null
          receipt_path?: string | null
          reference?: string | null
          status?: string
          void_reason?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          cutoff?: string
          id?: string
          number?: string | null
          paid_at?: string | null
          paid_by?: string | null
          paid_on?: string | null
          receipt_path?: string | null
          reference?: string | null
          status?: string
          void_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payout_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "payout_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_batches_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "payout_batches_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_items: {
        Row: {
          account_number: string | null
          account_type: string | null
          amount: number
          bank_name: string | null
          batch_id: string
          holder: string | null
          ledger_payment_id: string | null
          payee_id: string
          payee_kind: string
          payee_name: string | null
          services: Json
        }
        Insert: {
          account_number?: string | null
          account_type?: string | null
          amount: number
          bank_name?: string | null
          batch_id: string
          holder?: string | null
          ledger_payment_id?: string | null
          payee_id: string
          payee_kind: string
          payee_name?: string | null
          services?: Json
        }
        Update: {
          account_number?: string | null
          account_type?: string | null
          amount?: number
          bank_name?: string | null
          batch_id?: string
          holder?: string | null
          ledger_payment_id?: string | null
          payee_id?: string
          payee_kind?: string
          payee_name?: string | null
          services?: Json
        }
        Relationships: [
          {
            foreignKeyName: "payout_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "payout_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_items_ledger_payment_id_fkey"
            columns: ["ledger_payment_id"]
            isOneToOne: false
            referencedRelation: "ledger_payments"
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
      platform_features: {
        Row: {
          id: number
          insurers_enabled: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: number
          insurers_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: number
          insurers_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_features_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "platform_features_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          insurer_id: string | null
          marketing_opt_in: boolean
          partner_guide_seen_at: string | null
          partner_practice_done_at: string | null
          phone: string
          privacy_accepted_at: string | null
          provider_id: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
          verification_rejection_reason: string | null
          verification_reviewed_at: string | null
          verification_reviewed_by: string | null
          verification_status: string | null
          verification_submitted_at: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name: string
          id: string
          insurer_id?: string | null
          marketing_opt_in?: boolean
          partner_guide_seen_at?: string | null
          partner_practice_done_at?: string | null
          phone: string
          privacy_accepted_at?: string | null
          provider_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          verification_rejection_reason?: string | null
          verification_reviewed_at?: string | null
          verification_reviewed_by?: string | null
          verification_status?: string | null
          verification_submitted_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          insurer_id?: string | null
          marketing_opt_in?: boolean
          partner_guide_seen_at?: string | null
          partner_practice_done_at?: string | null
          phone?: string
          privacy_accepted_at?: string | null
          provider_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          verification_rejection_reason?: string | null
          verification_reviewed_at?: string | null
          verification_reviewed_by?: string | null
          verification_status?: string | null
          verification_submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_insurer_id_fkey"
            columns: ["insurer_id"]
            isOneToOne: false
            referencedRelation: "insurers"
            referencedColumns: ["id"]
          },
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
      provider_bank_accounts: {
        Row: {
          account_number: string
          account_type: string
          bank_name: string
          holder: string
          holder_nit: string | null
          provider_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_number: string
          account_type: string
          bank_name: string
          holder: string
          holder_nit?: string | null
          provider_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_number?: string
          account_type?: string
          bank_name?: string
          holder?: string
          holder_nit?: string | null
          provider_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_bank_accounts_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: true
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_bank_accounts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "provider_bank_accounts_updated_by_fkey"
            columns: ["updated_by"]
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
          is_mopt: boolean
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
          is_mopt?: boolean
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
          is_mopt?: boolean
          name?: string
          tow_type_supported?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      rate_limit_hits: {
        Row: {
          bucket: string
          hits: number
          subject: string
          window_start: string
        }
        Insert: {
          bucket: string
          hits?: number
          subject: string
          window_start: string
        }
        Update: {
          bucket?: string
          hits?: number
          subject?: string
          window_start?: string
        }
        Relationships: []
      }
      rate_versions: {
        Row: {
          created_at: string
          created_by: string | null
          created_by_name: string | null
          id: string
          kind: string
          note: string | null
          rate: number | null
          subject_id: string | null
          valid_from: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          kind: string
          note?: string | null
          rate?: number | null
          subject_id?: string | null
          valid_from: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          kind?: string
          note?: string | null
          rate?: number | null
          subject_id?: string | null
          valid_from?: string
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
      reinsurer_cedents: {
        Row: {
          consent_at: string | null
          consent_by: string | null
          consent_status: string
          created_at: string
          created_by: string | null
          id: string
          insurer_org_id: string
          reinsurer_org_id: string
          updated_at: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          consent_at?: string | null
          consent_by?: string | null
          consent_status?: string
          created_at?: string
          created_by?: string | null
          id?: string
          insurer_org_id: string
          reinsurer_org_id: string
          updated_at?: string
          valid_from: string
          valid_to?: string | null
        }
        Update: {
          consent_at?: string | null
          consent_by?: string | null
          consent_status?: string
          created_at?: string
          created_by?: string | null
          id?: string
          insurer_org_id?: string
          reinsurer_org_id?: string
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reinsurer_cedents_consent_by_fkey"
            columns: ["consent_by"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "reinsurer_cedents_consent_by_fkey"
            columns: ["consent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reinsurer_cedents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "reinsurer_cedents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reinsurer_cedents_insurer_org_id_fkey"
            columns: ["insurer_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reinsurer_cedents_reinsurer_org_id_fkey"
            columns: ["reinsurer_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      reinsurer_consent_events: {
        Row: {
          action: string
          actor: string | null
          actor_name: string | null
          created_at: string
          id: number
          ip: string | null
          link_id: string
          reason: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor?: string | null
          actor_name?: string | null
          created_at?: string
          id?: number
          ip?: string | null
          link_id: string
          reason?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor?: string | null
          actor_name?: string | null
          created_at?: string
          id?: number
          ip?: string | null
          link_id?: string
          reason?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reinsurer_consent_events_actor_fkey"
            columns: ["actor"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "reinsurer_consent_events_actor_fkey"
            columns: ["actor"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reinsurer_consent_events_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "reinsurer_cedents"
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
      request_notes: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          request_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          request_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "request_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_notes_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
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
      service_payments: {
        Row: {
          amount: number
          collected_by: string | null
          created_at: string
          gateway: string | null
          gateway_tx: string | null
          id: string
          method: string | null
          note: string | null
          paid_at: string | null
          receipt_number: string | null
          reference: string | null
          request_id: string
          status: string
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          collected_by?: string | null
          created_at?: string
          gateway?: string | null
          gateway_tx?: string | null
          id?: string
          method?: string | null
          note?: string | null
          paid_at?: string | null
          receipt_number?: string | null
          reference?: string | null
          request_id: string
          status?: string
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          collected_by?: string | null
          created_at?: string
          gateway?: string | null
          gateway_tx?: string | null
          id?: string
          method?: string | null
          note?: string | null
          paid_at?: string | null
          receipt_number?: string | null
          reference?: string | null
          request_id?: string
          status?: string
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_payments_collected_by_fkey"
            columns: ["collected_by"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "service_payments_collected_by_fkey"
            columns: ["collected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_payments_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_payments_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "service_payments_voided_by_fkey"
            columns: ["voided_by"]
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
          mopt_provider_id: string | null
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
          mopt_provider_id?: string | null
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
          mopt_provider_id?: string | null
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
      statement_observation_events: {
        Row: {
          amount: number | null
          author_id: string | null
          body: string
          created_at: string
          id: string
          kind: string
          observation_id: string
          side: string
        }
        Insert: {
          amount?: number | null
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          kind: string
          observation_id: string
          side: string
        }
        Update: {
          amount?: number | null
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          kind?: string
          observation_id?: string
          side?: string
        }
        Relationships: [
          {
            foreignKeyName: "statement_observation_events_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "statement_observation_events_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "statement_observation_events_observation_id_fkey"
            columns: ["observation_id"]
            isOneToOne: false
            referencedRelation: "statement_observations"
            referencedColumns: ["id"]
          },
        ]
      }
      statement_observations: {
        Row: {
          adjusted_amount: number | null
          created_at: string
          id: string
          request_id: string
          resolved_at: string | null
          statement_id: string
          status: string
        }
        Insert: {
          adjusted_amount?: number | null
          created_at?: string
          id?: string
          request_id: string
          resolved_at?: string | null
          statement_id: string
          status?: string
        }
        Update: {
          adjusted_amount?: number | null
          created_at?: string
          id?: string
          request_id?: string
          resolved_at?: string | null
          statement_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "statement_observations_statement_id_fkey"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "account_statements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "statement_observations_statement_id_request_id_fkey"
            columns: ["statement_id", "request_id"]
            isOneToOne: true
            referencedRelation: "account_statement_lines"
            referencedColumns: ["statement_id", "request_id"]
          },
        ]
      }
      terms_acceptances: {
        Row: {
          accepted_at: string
          ip: string | null
          profile_id: string
          terms_id: string
          user_agent: string | null
        }
        Insert: {
          accepted_at?: string
          ip?: string | null
          profile_id: string
          terms_id: string
          user_agent?: string | null
        }
        Update: {
          accepted_at?: string
          ip?: string | null
          profile_id?: string
          terms_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "terms_acceptances_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "terms_acceptances_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "terms_acceptances_terms_id_fkey"
            columns: ["terms_id"]
            isOneToOne: false
            referencedRelation: "terms_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      terms_documents: {
        Row: {
          body: string
          id: string
          kind: string
          published_at: string
          published_by: string | null
          title: string
          version: string
        }
        Insert: {
          body: string
          id?: string
          kind: string
          published_at?: string
          published_by?: string | null
          title: string
          version: string
        }
        Update: {
          body?: string
          id?: string
          kind?: string
          published_at?: string
          published_by?: string | null
          title?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "terms_documents_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "operator_stats"
            referencedColumns: ["operator_id"]
          },
          {
            foreignKeyName: "terms_documents_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      webhook_deliveries: {
        Row: {
          attempts: number
          created_at: string
          delivered_at: string | null
          event: string
          folio: string | null
          id: string
          last_error: string | null
          last_status_code: number | null
          net_request_id: number | null
          next_attempt_at: string
          payload: Json
          sent_at: string | null
          status: string
          webhook_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          event: string
          folio?: string | null
          id?: string
          last_error?: string | null
          last_status_code?: number | null
          net_request_id?: number | null
          next_attempt_at?: string
          payload: Json
          sent_at?: string | null
          status?: string
          webhook_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          event?: string
          folio?: string | null
          id?: string
          last_error?: string | null
          last_status_code?: number | null
          net_request_id?: number | null
          next_attempt_at?: string
          payload?: Json
          sent_at?: string | null
          status?: string
          webhook_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_webhook_id_fkey"
            columns: ["webhook_id"]
            isOneToOne: false
            referencedRelation: "insurer_webhooks"
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
      _cash_collected: { Args: { p_request: string }; Returns: number }
      _email_mopt_report: { Args: { p_report: string }; Returns: string }
      _ensure_onboarding: { Args: { p_org: string }; Returns: undefined }
      _generate_mopt_report: {
        Args: { p_month: string; p_mopt: string; p_send: boolean }
        Returns: string
      }
      _import_members: {
        Args: { p_members: Json; p_policy_id: string }
        Returns: Json
      }
      _insurer_branding_json: { Args: { p_insurer: string }; Returns: Json }
      _issue_insurer_api_key: {
        Args: { p_insurer: string; p_name: string }
        Returns: Json
      }
      _mark_payment_paid: {
        Args: {
          p_collected_by: string
          p_id: string
          p_method: string
          p_note: string
        }
        Returns: undefined
      }
      _mopt_compliance_for: {
        Args: { p_from: string; p_mopt: string; p_to: string }
        Returns: Json
      }
      _mopt_report_build: {
        Args: { p_month: string; p_mopt: string }
        Returns: Json
      }
      _new_webhook_secret: { Args: never; Returns: string }
      _onboarding_status_core: { Args: { p_org: string }; Returns: Json }
      _rea_cell: {
        Args: {
          p_asig_n: number
          p_asig_ok: number
          p_cost: number
          p_lleg_n: number
          p_lleg_ok: number
          p_members?: number
          p_n: number
        }
        Returns: Json
      }
      _rea_change: {
        Args: { p_cur: Json; p_key: string; p_prev: Json }
        Returns: number
      }
      _rea_loss_cell: {
        Args: { p_cost: number; p_exposure: number; p_n: number }
        Returns: Json
      }
      _rea_quarter_bounds: {
        Args: { p_quarter: number; p_year: number }
        Returns: {
          q_from: string
          q_to: string
        }[]
      }
      _rea_quarter_raw: {
        Args: { p_from: string; p_reinsurer: string; p_to: string }
        Returns: {
          cost: number
          exposure: number
          insurer_name: string
          insurer_org_id: string
          services: number
        }[]
      }
      _reinsurer_cases: {
        Args: { p_from: string; p_reinsurer: string; p_to: string }
        Returns: {
          arrival_met: boolean
          assignment_met: boolean
          covered: number
          insurer_name: string
          insurer_org_id: string
          month: string
          service_type: string
        }[]
      }
      _require_operator: { Args: never; Returns: string }
      _save_insurer_branding: {
        Args: {
          p_color: string
          p_enabled: boolean
          p_insurer: string
          p_logo_path: string
          p_name: string
        }
        Returns: undefined
      }
      _vault_secret: { Args: { p_name: string }; Returns: string }
      _webhook_case_data: {
        Args: { p_insurer: string; p_request: string }
        Returns: Json
      }
      _webhook_enqueue: {
        Args: {
          p_data: Json
          p_event: string
          p_folio: string
          p_webhook: string
        }
        Returns: string
      }
      _webhook_send: { Args: { p_delivery: string }; Returns: undefined }
      accept_org_invitation: { Args: { p_token: string }; Returns: Json }
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
          mopt_provider_id: string | null
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
      accept_terms: { Args: { p_terms_id: string }; Returns: Json }
      account_request_ids: {
        Args: { p_id: string; p_kind: string }
        Returns: string[]
      }
      admin_account_360: {
        Args: { p_from: string; p_id: string; p_kind: string; p_to: string }
        Returns: Json
      }
      admin_add_org_member: {
        Args: { p_email: string; p_organization_id: string; p_role?: string }
        Returns: string
      }
      admin_answer_observation: {
        Args: {
          p_adjusted_amount?: number
          p_body: string
          p_observation: string
          p_resolution?: string
        }
        Returns: undefined
      }
      admin_app_release_policy: {
        Args: never
        Returns: {
          latest_version: string
          min_version: string
          platform: string
          store_url: string | null
          updated_at: string
          updated_by: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "app_release_policy"
          isOneToOne: false
          isSetofReturn: true
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
          mopt_provider_id: string | null
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
      admin_audit_log: {
        Args: {
          p_action?: string
          p_actor?: string
          p_from?: string
          p_limit?: number
          p_offset?: number
          p_record?: string
          p_table?: string
          p_to?: string
        }
        Returns: {
          action: string
          actor_email: string
          actor_id: string
          actor_name: string
          actor_role: string
          changes: Json
          id: number
          occurred_at: string
          record_id: string
          record_label: string
          table_name: string
          total_count: number
        }[]
      }
      admin_audit_log_facets: { Args: never; Returns: Json }
      admin_business_dashboard: { Args: never; Returns: Json }
      admin_cancel_rate_version: { Args: { p_id: string }; Returns: undefined }
      admin_cancel_request: {
        Args: { p_reason?: string; p_request_id: string }
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
          mopt_provider_id: string | null
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
      admin_complete_onboarding: {
        Args: { p_notes?: string; p_org: string }
        Returns: Json
      }
      admin_create_institution: {
        Args: {
          p_contact_email: string
          p_contact_name: string
          p_contact_phone: string
          p_name: string
          p_tax_id: string
          p_type: string
        }
        Returns: string
      }
      admin_create_payout_batch: {
        Args: { p_cutoff?: string }
        Returns: string
      }
      admin_dte_settings: { Args: never; Returns: Json }
      admin_finance_by_insurer: {
        Args: { p_from: string; p_to: string }
        Returns: {
          a_facturar: number
          aseguradora: string
          bruto: number
          copagos: number
          insurer_id: string
          servicios: number
        }[]
      }
      admin_finance_detail: {
        Args: { p_from: string; p_to: string }
        Returns: {
          aseguradora: string
          bruto: number
          cliente: string
          completado: string
          copago: number
          cubierto: number
          folio: string
          operador: string
          proveedor: string
          servicio: string
        }[]
      }
      admin_finance_summary: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      admin_generate_mopt_report: {
        Args: { p_month: string; p_mopt: string; p_send?: boolean }
        Returns: Json
      }
      admin_generate_statement: {
        Args: { p_from: string; p_org: string; p_to: string }
        Returns: string
      }
      admin_insurer_branding: { Args: { p_insurer: string }; Returns: Json }
      admin_invite_org_member: {
        Args: { p_email: string; p_org: string; p_role?: string }
        Returns: Json
      }
      admin_issue_statement: { Args: { p_id: string }; Returns: string }
      admin_ledger_balances: {
        Args: never
        Returns: {
          balance: number
          creditor_id: string
          creditor_kind: string
          creditor_name: string
          debtor_id: string
          debtor_kind: string
          debtor_name: string
          last_paid_on: string
          owed: number
          paid: number
          services: number
        }[]
      }
      admin_ledger_payments: {
        Args: { p_limit?: number }
        Returns: {
          amount: number
          created_at: string
          created_by_name: string
          id: string
          note: string
          paid_on: string
          payee_kind: string
          payee_name: string
          payer_kind: string
          payer_name: string
          reference: string
          void_reason: string
          voided_at: string
        }[]
      }
      admin_link_insurer_user: {
        Args: { p_insurer_id: string; p_user_id: string }
        Returns: undefined
      }
      admin_link_mopt_user: {
        Args: { p_provider_id: string; p_user_id: string }
        Returns: undefined
      }
      admin_list_organizations: {
        Args: never
        Returns: {
          id: string
          insurer_id: string
          members: number
          name: string
          provider_id: string
          status: string
          type: string
        }[]
      }
      admin_list_partner_leads: { Args: { p_status?: string }; Returns: Json }
      admin_list_payout_batches: {
        Args: never
        Returns: {
          created_at: string
          cutoff: string
          id: string
          missing_bank: number
          number: string
          paid_on: string
          payees: number
          reference: string
          status: string
          total: number
        }[]
      }
      admin_list_provider_commissions: {
        Args: never
        Returns: {
          commission_rate: number
          provider_id: string
        }[]
      }
      admin_mark_message_sent: { Args: { p_id: string }; Returns: undefined }
      admin_mark_payout_paid: {
        Args: {
          p_id: string
          p_paid_on: string
          p_receipt_path: string
          p_reference: string
        }
        Returns: number
      }
      admin_mark_statement_paid: {
        Args: { p_id: string; p_paid_on: string; p_reference: string }
        Returns: undefined
      }
      admin_mopt_reports: {
        Args: { p_mopt: string }
        Returns: {
          email_status: string
          emailed_to: string[]
          generated_at: string
          month: string
          services: number
        }[]
      }
      admin_onboarding_overview: {
        Args: never
        Returns: {
          completed_at: string
          name: string
          organization_id: string
          started_at: string
          steps_done: number
          steps_total: number
          type: string
        }[]
      }
      admin_onboarding_status: { Args: { p_org: string }; Returns: Json }
      admin_org_members: {
        Args: { p_organization_id: string }
        Returns: {
          created_at: string
          email: string
          full_name: string
          profile_id: string
          role: string
          status: string
        }[]
      }
      admin_partner_application: {
        Args: { p_operator_id: string }
        Returns: Json
      }
      admin_partner_terms: { Args: { p_operator: string }; Returns: Json }
      admin_partner_training: { Args: { p_operator: string }; Returns: Json }
      admin_payout_batch: { Args: { p_id: string }; Returns: Json }
      admin_preview_eligibility: {
        Args: {
          p_document?: string
          p_lat?: number
          p_lng?: number
          p_org: string
          p_service_type: string
          p_total?: number
        }
        Returns: Json
      }
      admin_provider_bank: { Args: { p_provider: string }; Returns: Json }
      admin_publish_terms: {
        Args: {
          p_body: string
          p_kind: string
          p_title: string
          p_version: string
        }
        Returns: string
      }
      admin_rate_history: {
        Args: { p_kind: string; p_subject: string }
        Returns: {
          created_at: string
          created_by_name: string
          id: string
          note: string
          rate: number
          status: string
          valid_from: string
          valid_until: string
        }[]
      }
      admin_rate_overview: {
        Args: never
        Returns: {
          current_rate: number
          kind: string
          next_from: string
          next_is_default: boolean
          next_rate: number
          own_rate: boolean
          subject_id: string
          subject_name: string
          versions: number
        }[]
      }
      admin_record_service_payment: {
        Args: { p_id: string; p_method: string; p_note: string }
        Returns: undefined
      }
      admin_reinsurers: { Args: never; Returns: Json }
      admin_reset_mfa: {
        Args: { p_profile_id: string; p_reason: string }
        Returns: number
      }
      admin_review_document: {
        Args: {
          p_doc_type: string
          p_expires_on?: string
          p_note?: string
          p_operator_id: string
          p_status: string
        }
        Returns: Json
      }
      admin_revoke_org_invitation: {
        Args: { p_id: string }
        Returns: undefined
      }
      admin_save_dte_settings: {
        Args: {
          p_ambiente: string
          p_cod_estable: string
          p_cod_punto_venta: string
          p_emisor: Json
          p_prices_include_iva: boolean
        }
        Returns: undefined
      }
      admin_save_insurer_branding: {
        Args: {
          p_color: string
          p_enabled: boolean
          p_insurer: string
          p_logo_path: string
          p_name: string
        }
        Returns: undefined
      }
      admin_save_org_fiscal: {
        Args: { p_dte_type: string; p_org: string; p_receptor: Json }
        Returns: undefined
      }
      admin_schedule_rate: {
        Args: {
          p_effective?: string
          p_kind: string
          p_note?: string
          p_rate: number
          p_subject: string
        }
        Returns: string
      }
      admin_service_payments: {
        Args: { p_from: string; p_status?: string; p_to: string }
        Returns: {
          amount: number
          completed_at: string
          folio: string
          id: string
          method: string
          note: string
          operator_name: string
          paid_at: string
          receipt_number: string
          request_id: string
          service_type: string
          status: string
          user_name: string
          void_reason: string
        }[]
      }
      admin_set_app_release_policy: {
        Args: {
          p_latest_version: string
          p_min_version: string
          p_platform: string
          p_store_url: string
        }
        Returns: undefined
      }
      admin_set_insurers_enabled: {
        Args: { p_enabled: boolean }
        Returns: undefined
      }
      admin_set_mopt_fee: {
        Args: { p_provider_id: string; p_rate: number }
        Returns: undefined
      }
      admin_set_operator_commission: {
        Args: { p_operator_id: string; p_rate?: number }
        Returns: Json
      }
      admin_set_operator_vehicle: {
        Args: {
          p_capacity_m3?: number
          p_operator_id: string
          p_plate: string
          p_vehicle_type?: string
        }
        Returns: string
      }
      admin_set_operator_verification: {
        Args: { p_operator_id: string; p_reason?: string; p_status: string }
        Returns: undefined
      }
      admin_set_org_contract: {
        Args: {
          p_monthly_cap: number
          p_on_cap: string
          p_org: string
          p_reference: string
          p_tariff_notes: string
          p_valid_from: string
          p_valid_to: string
        }
        Returns: undefined
      }
      admin_set_org_sla: {
        Args: {
          p_arrival: number
          p_assignment: number
          p_organization_id: string
        }
        Returns: undefined
      }
      admin_set_provider_bank: {
        Args: {
          p_bank: string
          p_holder: string
          p_nit: string
          p_number: string
          p_provider: string
          p_type: string
        }
        Returns: undefined
      }
      admin_set_provider_commission: {
        Args: { p_provider_id: string; p_rate: number }
        Returns: Json
      }
      admin_set_reinsurer_link: {
        Args: {
          p_insurer_org: string
          p_reinsurer_org: string
          p_valid_from: string
          p_valid_to: string
        }
        Returns: string
      }
      admin_settlement_by_operator: {
        Args: { p_from: string; p_to: string }
        Returns: {
          a_pagar: number
          bruto: number
          comision: number
          comision_pct: number
          efectivo: number
          empresa: string
          operador: string
          operator_id: string
          saldo: number
          servicios: number
        }[]
      }
      admin_settlement_by_provider: {
        Args: { p_from: string; p_to: string }
        Returns: {
          a_pagar: number
          bruto: number
          comision: number
          comision_pct: number
          destinatario: string
          efectivo: number
          es_independiente: boolean
          provider_id: string
          saldo: number
          servicios: number
          sin_precio: number
        }[]
      }
      admin_settlement_detail: {
        Args: { p_from: string; p_to: string }
        Returns: {
          a_pagar: number
          bruto: number
          comision: number
          comision_pct: number
          completado: string
          destinatario: string
          efectivo: number
          folio: string
          operador: string
          saldo: number
          servicio: string
        }[]
      }
      admin_update_org_member: {
        Args: {
          p_organization_id: string
          p_profile_id: string
          p_role?: string
          p_status?: string
        }
        Returns: undefined
      }
      admin_update_partner_lead: {
        Args: { p_id: string; p_notes?: string; p_status?: string }
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
      admin_void_payout_batch: { Args: { p_id: string }; Returns: undefined }
      admin_void_service_payment: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      admin_void_statement: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      alert_stale_pool_requests: { Args: never; Returns: undefined }
      anonymize_account: { Args: { p_user_id: string }; Returns: Json }
      app_version_check: {
        Args: { p_platform: string; p_version: string }
        Returns: Json
      }
      approve_statement: { Args: { p_id: string }; Returns: number }
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
          mopt_provider_id: string | null
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
      auth_insurer_id: { Args: never; Returns: string }
      auth_mopt_id: { Args: never; Returns: string }
      auth_org: {
        Args: never
        Returns: {
          insurer_id: string
          member_role: string
          name: string
          organization_id: string
          provider_id: string
          type: string
        }[]
      }
      auth_reinsurer_org: { Args: never; Returns: string }
      auth_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      branding_insurer_for_caller: { Args: never; Returns: string }
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
      check_operator_document_expiry: { Args: never; Returns: Json }
      check_org_budgets: { Args: never; Returns: number }
      commission_rate_at: {
        Args: { p_at: string; p_operator: string; p_provider: string }
        Returns: number
      }
      complete_partner_practice: { Args: never; Returns: undefined }
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
          mopt_provider_id: string | null
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
      compute_case_km: { Args: { p_request_id: string }; Returns: undefined }
      confirm_gateway_payment: {
        Args: {
          p_amount: number
          p_approved: boolean
          p_gateway: string
          p_gateway_tx: string
          p_reference: string
        }
        Returns: string
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
      current_terms: { Args: { p_kind: string }; Returns: Json }
      current_terms_id: { Args: { p_kind: string }; Returns: string }
      default_commission_rate: { Args: never; Returns: number }
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
      export_my_data: { Args: never; Returns: Json }
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
      haversine_km: {
        Args: { lat1: number; lat2: number; lng1: number; lng2: number }
        Returns: number
      }
      id_documents_frozen: { Args: never; Returns: boolean }
      import_members_for_insurer: {
        Args: { p_insurer_id: string; p_members: Json; p_policy_number: string }
        Returns: Json
      }
      import_policy_members: {
        Args: { p_members: Json; p_policy_id: string }
        Returns: Json
      }
      insurer_pays_for: {
        Args: { p_coverage: Json; p_service_type: string }
        Returns: boolean
      }
      insurer_portal_role: { Args: never; Returns: string }
      insurers_enabled: { Args: never; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_my_insurer: { Args: { p_insurer_id: string }; Returns: boolean }
      is_my_plan: { Args: { p_plan_id: string }; Returns: boolean }
      is_my_policy: { Args: { p_policy_id: string }; Returns: boolean }
      is_operator: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      is_support: { Args: never; Returns: boolean }
      ledger_balances_all: {
        Args: never
        Returns: {
          balance: number
          creditor_id: string
          creditor_kind: string
          debtor_id: string
          debtor_kind: string
          last_paid_on: string
          owed: number
          paid: number
          services: number
        }[]
      }
      ledger_obligations: {
        Args: never
        Returns: {
          amount: number
          completed_at: string
          concept: string
          creditor_id: string
          creditor_kind: string
          debtor_id: string
          debtor_kind: string
          request_id: string
          service_type: string
        }[]
      }
      ledger_party_name: {
        Args: { p_id: string; p_kind: string }
        Returns: string
      }
      list_insurer_cases: {
        Args: never
        Returns: {
          arrival_met: boolean
          assignment_met: boolean
          copago: number
          coverage_status: string
          created_at: string
          cubierto: number
          folio: string
          service_type: string
          status: string
          total_price: number
        }[]
      }
      list_statements: {
        Args: { p_org?: string }
        Returns: {
          approved_amount: number
          approved_at: string
          id: string
          issued_at: string
          number: string
          organization_id: string
          organization_name: string
          organization_type: string
          paid_at: string
          paid_reference: string
          period_from: string
          period_to: string
          status: string
          totals: Json
        }[]
      }
      mark_partner_guide_seen: { Args: never; Returns: undefined }
      member_document_key: { Args: { p_doc: string }; Returns: string }
      member_relationship: { Args: { p_texto: string }; Returns: string }
      mopt_can_manage_payments: { Args: never; Returns: boolean }
      mopt_compliance: { Args: { p_from: string; p_to: string }; Returns: Json }
      mopt_fee_rate_at: {
        Args: { p_at: string; p_mopt: string }
        Returns: number
      }
      mopt_fleet: {
        Args: never
        Returns: {
          active_address: string
          active_folio: string
          active_request_id: string
          active_status: string
          avg_rating: number
          full_name: string
          is_online: boolean
          lat: number
          lng: number
          operator_id: string
          phone: string
          plate: string
          ratings_count: number
          updated_at: string
        }[]
      }
      mopt_in_progress_services: {
        Args: never
        Returns: {
          client_name: string
          completed_at: string
          created_at: string
          folio: string
          id: string
          operator_name: string
          pickup_address: string
          pickup_lat: number
          pickup_lng: number
          service_type: string
          status: string
          total_price: number
          vehicle_plate: string
          zone: string
        }[]
      }
      mopt_km_by_vehicle: {
        Args: { p_from: string; p_to: string }
        Returns: {
          approach_km: number
          cases: number
          on_time_pct: number
          operator: string
          operator_id: string
          plate: string
          total_km: number
          tow_km: number
        }[]
      }
      mopt_list_operators: {
        Args: never
        Returns: {
          avg_rating: number
          balance: number
          full_name: string
          in_program: boolean
          last_paid_on: string
          observed_amount: number
          observed_cases: number
          operator_id: string
          owed: number
          paid: number
          phone: string
          plate: string
          ratings_count: number
          services: number
          verification_status: string
        }[]
      }
      mopt_list_payments: {
        Args: never
        Returns: {
          amount: number
          created_at: string
          id: string
          note: string
          paid_on: string
          payee_id: string
          payee_name: string
          reference: string
          void_reason: string
          voided_at: string
        }[]
      }
      mopt_list_services: {
        Args: { p_from: string; p_to: string }
        Returns: {
          client_name: string
          completed_at: string
          created_at: string
          folio: string
          id: string
          operator_name: string
          pickup_address: string
          pickup_lat: number
          pickup_lng: number
          service_type: string
          status: string
          total_price: number
          vehicle_plate: string
          zone: string
        }[]
      }
      mopt_month_consumption: {
        Args: { p_day?: string; p_mopt_provider: string }
        Returns: number
      }
      mopt_monthly_reports_job: { Args: never; Returns: number }
      mopt_open_reservation: {
        Args: { p_mopt_provider: string }
        Returns: number
      }
      mopt_overview: { Args: never; Returns: Json }
      mopt_payer_for: {
        Args: {
          p_coverage: Json
          p_lat: number
          p_lng: number
          p_service_type: string
        }
        Returns: string
      }
      mopt_program_capped: {
        Args: { p_mopt_provider: string }
        Returns: boolean
      }
      mopt_program_for: {
        Args: { p_lat: number; p_lng: number; p_service_type: string }
        Returns: string
      }
      mopt_program_has_budget: {
        Args: { p_mopt_provider: string }
        Returns: boolean
      }
      mopt_report: { Args: { p_month: string }; Returns: Json }
      mopt_reports_list: {
        Args: never
        Returns: {
          email_status: string
          generated_at: string
          month: string
          services: number
        }[]
      }
      mopt_service_detail: { Args: { p_request_id: string }; Returns: Json }
      mopt_vehicle_cases: {
        Args: {
          p_from: string
          p_operator_id: string
          p_plate: string
          p_to: string
        }
        Returns: {
          approach_km: number
          arrival_seconds: number
          completed_at: string
          declared_km: number
          folio: string
          on_time: boolean
          request_id: string
          service_type: string
          tow_km: number
        }[]
      }
      mopt_zone_open_now: {
        Args: { p_days: number[]; p_from: string; p_to: string }
        Returns: boolean
      }
      mopt_zones_mine: {
        Args: never
        Returns: {
          id: string
          is_active: boolean
          name: string
          polygon: Json
          service_types: string[]
        }[]
      }
      my_insurer_branding: { Args: never; Returns: Json }
      my_operator_earnings: {
        Args: { p_from: string; p_to: string }
        Returns: {
          a_pagar: number
          bruto: number
          comision: number
          comision_pct: number
          efectivo: number
          saldo: number
          servicios: number
        }[]
      }
      my_operator_service_earnings: {
        Args: { p_request_ids: string[] }
        Returns: {
          a_cobrar: number
          bruto: number
          comision: number
          comision_pct: number
          request_id: string
        }[]
      }
      my_organization: { Args: never; Returns: Json }
      my_partner_application: { Args: never; Returns: Json }
      my_partner_training: { Args: never; Returns: Json }
      my_payouts: { Args: never; Returns: Json }
      my_pending_payments: {
        Args: never
        Returns: {
          amount: number
          completed_at: string
          folio: string
          request_id: string
          service_type: string
        }[]
      }
      my_request_operators: {
        Args: { p_request_ids: string[] }
        Returns: {
          operator_name: string
          operator_phone: string
          request_id: string
        }[]
      }
      next_case_folio: { Args: never; Returns: string }
      normalize_document: { Args: { p_doc: string }; Returns: string }
      notify_ops: { Args: { p_text: string }; Returns: undefined }
      observe_statement_case: {
        Args: { p_body: string; p_request: string; p_statement: string }
        Returns: string
      }
      operator_can_serve: {
        Args: { p_operator: string; p_service_type: string }
        Returns: boolean
      }
      operator_confirm_cash: { Args: { p_request: string }; Returns: Json }
      operator_fits_program: {
        Args: { p_mopt_provider: string; p_operator: string }
        Returns: boolean
      }
      operator_pending_cash: {
        Args: never
        Returns: {
          amount: number
          completed_at: string
          folio: string
          request_id: string
          service_type: string
          user_name: string
        }[]
      }
      org_access_log: {
        Args: { p_limit?: number }
        Returns: {
          kind: string
          occurred_at: string
          what: string
          who: string
        }[]
      }
      org_contract_status: { Args: { p_org?: string }; Returns: Json }
      org_invite: { Args: { p_email: string; p_role?: string }; Returns: Json }
      org_manager: {
        Args: never
        Returns: {
          member_role: string
          organization_id: string
        }[]
      }
      org_revoke_invitation: { Args: { p_id: string }; Returns: undefined }
      org_role_requires_mfa: { Args: { p_role: string }; Returns: boolean }
      org_team: { Args: never; Returns: Json }
      org_update_member: {
        Args: { p_profile_id: string; p_role?: string; p_status?: string }
        Returns: undefined
      }
      partner_can_edit: { Args: { p_operator: string }; Returns: boolean }
      partner_doc_bucket: { Args: { p_doc_type: string }; Returns: string }
      partner_expiring_docs: { Args: never; Returns: string[] }
      partner_missing: { Args: { p_operator: string }; Returns: string[] }
      partner_required_docs: { Args: never; Returns: string[] }
      partner_save_bank: {
        Args: {
          p_account_number: string
          p_account_type: string
          p_bank_name: string
          p_holder: string
        }
        Returns: undefined
      }
      partner_save_identity: {
        Args: {
          p_dui: string
          p_full_name: string
          p_nit: string
          p_phone: string
        }
        Returns: undefined
      }
      partner_save_services: {
        Args: { p_service_types: string[] }
        Returns: undefined
      }
      partner_save_vehicle: {
        Args: {
          p_capacity_m3?: number
          p_plate: string
          p_vehicle_type: string
        }
        Returns: undefined
      }
      partner_terms_pending: { Args: { p_operator: string }; Returns: boolean }
      partner_try_reactivate: { Args: { p_operator: string }; Returns: boolean }
      payment_gateway_enabled: { Args: never; Returns: boolean }
      payout_services_for: {
        Args: { p_cutoff: string; p_id: string; p_kind: string }
        Returns: Json
      }
      plan_cubre_servicio: {
        Args: { p_plan_id: string; p_service_type: string }
        Returns: boolean
      }
      platform_commission_at: { Args: { p_at: string }; Returns: number }
      platform_features: { Args: never; Returns: Json }
      point_in_polygon: {
        Args: { p_lat: number; p_lng: number; p_polygon: Json }
        Returns: boolean
      }
      portal_branding: { Args: never; Returns: Json }
      portal_create_api_key: { Args: { p_name: string }; Returns: Json }
      portal_delete_webhook: { Args: { p_id: string }; Returns: undefined }
      portal_import_members: {
        Args: { p_members: Json; p_policy: string; p_row_offset?: number }
        Returns: Json
      }
      portal_insurer_cases: {
        Args: { p_from: string; p_to: string }
        Returns: {
          arrival_met: boolean
          assignment_met: boolean
          copago: number
          coverage_status: string
          created_at: string
          cubierto: number
          folio: string
          service_type: string
          status: string
          total_price: number
          zone: string
        }[]
      }
      portal_insurer_catalog: { Args: never; Returns: Json }
      portal_integrations: { Args: never; Returns: Json }
      portal_policy_members: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_policy: string
          p_search?: string
        }
        Returns: Json
      }
      portal_redeliver_webhook: {
        Args: { p_delivery: string }
        Returns: undefined
      }
      portal_reinsurer_links: { Args: never; Returns: Json }
      portal_revoke_api_key: { Args: { p_id: string }; Returns: undefined }
      portal_rotate_api_key: {
        Args: { p_grace_hours?: number; p_id: string }
        Returns: Json
      }
      portal_rotate_webhook_secret: { Args: { p_id: string }; Returns: Json }
      portal_save_branding: {
        Args: {
          p_color: string
          p_enabled: boolean
          p_logo_path: string
          p_name: string
        }
        Returns: undefined
      }
      portal_save_plan: {
        Args: {
          p_code: string
          p_description: string
          p_id: string
          p_is_active: boolean
          p_name: string
        }
        Returns: string
      }
      portal_save_policy: {
        Args: {
          p_ends_on: string
          p_holder_name: string
          p_id: string
          p_plan: string
          p_policy_number: string
          p_starts_on: string
          p_status: string
        }
        Returns: string
      }
      portal_save_webhook: {
        Args: {
          p_description: string
          p_events: string[]
          p_id: string
          p_is_active: boolean
          p_url: string
        }
        Returns: Json
      }
      portal_set_member_active: {
        Args: { p_active: boolean; p_member: string; p_reason?: string }
        Returns: undefined
      }
      portal_set_reinsurer_consent: {
        Args: { p_grant: boolean; p_link: string; p_reason?: string }
        Returns: undefined
      }
      portal_test_webhook: { Args: { p_id: string }; Returns: string }
      portal_webhook_deliveries: {
        Args: { p_limit?: number; p_webhook: string }
        Returns: {
          attempts: number
          created_at: string
          delivered_at: string
          event: string
          folio: string
          id: string
          last_error: string
          last_status_code: number
          next_attempt_at: string
          payload: Json
          status: string
        }[]
      }
      preview_mopt_program: {
        Args: { p_lat: number; p_lng: number; p_service_type: string }
        Returns: Json
      }
      preview_mopt_services: {
        Args: { p_lat: number; p_lng: number }
        Returns: string[]
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
      process_webhook_deliveries: { Args: never; Returns: Json }
      purge_expired_personal_data: { Args: never; Returns: Json }
      rate_limit_hit: {
        Args: {
          p_bucket: string
          p_limit: number
          p_subject?: string
          p_window_seconds: number
        }
        Returns: boolean
      }
      rate_service: {
        Args: { p_comment?: string; p_request_id: string; p_stars: number }
        Returns: Json
      }
      rate_version_at: {
        Args: { p_at: string; p_kind: string; p_subject: string }
        Returns: {
          found: boolean
          rate: number
        }[]
      }
      regenerate_my_request_pin: {
        Args: { p_request_id: string }
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
      register_ledger_payment: {
        Args: {
          p_amount: number
          p_note?: string
          p_paid_on?: string
          p_payee_id: string
          p_payee_kind: string
          p_payer_id: string
          p_payer_kind: string
          p_reference?: string
        }
        Returns: string
      }
      reinsurer_dashboard: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      reinsurer_loss_report: {
        Args: { p_quarter: number; p_year: number }
        Returns: Json
      }
      reinsurer_min_cell: { Args: never; Returns: number }
      request_belongs_to_my_insurer: {
        Args: { p_request_id: string }
        Returns: boolean
      }
      request_belongs_to_my_mopt: {
        Args: { p_request_id: string }
        Returns: boolean
      }
      request_operator_badge: { Args: { p_request: string }; Returns: Json }
      request_sla: {
        Args: { p_request_id: string }
        Returns: {
          arrival_seconds: number
          arrival_target: number
          assignment_seconds: number
          assignment_target: number
          insurer_name: string
          service_seconds: number
        }[]
      }
      require_insurer_role: { Args: { p_roles: string[] }; Returns: string }
      revoke_insurer_api_key: { Args: { p_key_id: string }; Returns: undefined }
      semver_cmp: { Args: { a: string; b: string }; Returns: number }
      send_message: {
        Args: { p_message: string; p_request_id: string }
        Returns: Json
      }
      service_payer_info: {
        Args: { p_request_ids: string[] }
        Returns: {
          has_copay: boolean
          label: string
          payer: string
          request_id: string
        }[]
      }
      service_payment: { Args: { p_request: string }; Returns: Json }
      session_has_mfa: { Args: never; Returns: boolean }
      set_active_pricing_rule: { Args: { p_rule_id: string }; Returns: Json }
      set_marketing_opt_in: { Args: { p_value: boolean }; Returns: undefined }
      staff_add_request_note: {
        Args: { p_body: string; p_request_id: string }
        Returns: string
      }
      staff_ops_alerts: { Args: never; Returns: Json }
      staff_pin_status: { Args: { p_request_id: string }; Returns: Json }
      staff_request_notes: {
        Args: { p_request_id: string }
        Returns: {
          author_name: string
          author_role: string
          body: string
          created_at: string
          id: string
        }[]
      }
      staff_reset_pin_lockout: {
        Args: { p_note: string; p_request_id: string }
        Returns: number
      }
      statement_access: { Args: { p_id: string }; Returns: string }
      statement_adjustment: {
        Args: { p_request_id: string }
        Returns: {
          amount: number
          statement_number: string
        }[]
      }
      statement_candidate_lines: {
        Args: { p_exclude: string; p_from: string; p_org: string; p_to: string }
        Returns: {
          amount: number
          completed_at: string
          copay: number
          fee: number
          folio: string
          provider_id: string
          provider_kind: string
          provider_name: string
          request_id: string
          service_type: string
          total_km: number
          tow_km: number
        }[]
      }
      statement_detail: { Args: { p_id: string }; Returns: Json }
      statement_totals: { Args: { p_statement: string }; Returns: Json }
      submit_operator_verification: { Args: never; Returns: undefined }
      submit_partner_lead: {
        Args: {
          p_email?: string
          p_full_name: string
          p_phone: string
          p_service_types: string[]
          p_vehicle_type: string
          p_website?: string
          p_zone: string
        }
        Returns: Json
      }
      suggest_nearest_operators: {
        Args: { p_limit?: number; p_request_id: string }
        Returns: {
          distance_km: number
          full_name: string
          last_seen: string
          operator_id: string
          provider_name: string
        }[]
      }
      sv_day_start: { Args: { d: string }; Returns: string }
      sv_department: { Args: { p_lat: number; p_lng: number }; Returns: string }
      sv_month: { Args: { p_ts: string }; Returns: string }
      sv_today: { Args: never; Returns: string }
      trail_km: {
        Args: { p_from: string; p_request_id: string; p_to: string }
        Returns: number
      }
      unaccent_simple: { Args: { p: string }; Returns: string }
      unregister_device_token: {
        Args: { p_expo_push_token: string }
        Returns: boolean
      }
      upsert_operator_document: {
        Args: {
          p_bucket: string
          p_doc_type: string
          p_expires_on?: string
          p_path: string
        }
        Returns: undefined
      }
      upsert_operator_location: {
        Args: { p_is_online?: boolean; p_lat: number; p_lng: number }
        Returns: Json
      }
      user_amount_due: { Args: { p_request: string }; Returns: number }
      user_start_card_payment: { Args: { p_request: string }; Returns: Json }
      verify_insurer_api_key: { Args: { p_key: string }; Returns: string }
      verify_pin: { Args: { p_hash: string; p_pin: string }; Returns: boolean }
      verify_request_pin: {
        Args: { p_pin: string; p_request_id: string }
        Returns: Json
      }
      void_ledger_payment: {
        Args: { p_payment_id: string; p_reason: string }
        Returns: undefined
      }
      webhook_event_types: { Args: never; Returns: string[] }
      webhook_url_ok: { Args: { p_url: string }; Returns: boolean }
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
        | "PIN_REGENERATED"
        | "PIN_LOCKOUT_RESET"
      request_status:
        | "initiated"
        | "assigned"
        | "en_route"
        | "active"
        | "completed"
        | "cancelled"
      tow_type: "light" | "heavy"
      user_role: "USER" | "OPERATOR" | "ADMIN" | "INSURER" | "MOPT" | "SUPPORT"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
        "PIN_REGENERATED",
        "PIN_LOCKOUT_RESET",
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
      user_role: ["USER", "OPERATOR", "ADMIN", "INSURER", "MOPT", "SUPPORT"],
    },
  },
} as const
