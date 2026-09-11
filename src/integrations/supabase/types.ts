export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      agent_messages: {
        Row: {
          agent_name: string
          body: string
          channel: string
          created_at: string
          customer_id: string
          delivered_via: string | null
          id: string
          invoice_ids: string[] | null
          is_demo: boolean
          metadata: Json | null
          recipient_email: string | null
          recipient_name: string | null
          recipient_type: string
          run_id: string
          sent_at: string | null
          status: string
          subject: string | null
          template_type: string
        }
        Insert: {
          agent_name: string
          body: string
          channel?: string
          created_at?: string
          customer_id: string
          delivered_via?: string | null
          id?: string
          invoice_ids?: string[] | null
          is_demo?: boolean
          metadata?: Json | null
          recipient_email?: string | null
          recipient_name?: string | null
          recipient_type?: string
          run_id: string
          sent_at?: string | null
          status?: string
          subject?: string | null
          template_type: string
        }
        Update: {
          agent_name?: string
          body?: string
          channel?: string
          created_at?: string
          customer_id?: string
          delivered_via?: string | null
          id?: string
          invoice_ids?: string[] | null
          is_demo?: boolean
          metadata?: Json | null
          recipient_email?: string | null
          recipient_name?: string | null
          recipient_type?: string
          run_id?: string
          sent_at?: string | null
          status?: string
          subject?: string | null
          template_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_messages_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_messages_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_ar_aging_current"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "agent_messages_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customers_at_risk"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_messages_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_growth_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_messages_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_payment_behaviour"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "agent_messages_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_sec_monitoring_dashboard"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "agent_messages_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_processed_events: {
        Row: {
          agent_name: string
          event_id: string
          processed_at: string
        }
        Insert: {
          agent_name: string
          event_id: string
          processed_at?: string
        }
        Update: {
          agent_name?: string
          event_id?: string
          processed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_processed_events_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "credit_events"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_runs: {
        Row: {
          actions_taken: number | null
          agent_name: string
          completed_at: string | null
          conditions_found: number | null
          customers_scanned: number | null
          error_message: string | null
          id: string
          messages_composed: number | null
          run_id: string
          started_at: string
          status: string
          summary: string | null
          triggered_by: string | null
        }
        Insert: {
          actions_taken?: number | null
          agent_name: string
          completed_at?: string | null
          conditions_found?: number | null
          customers_scanned?: number | null
          error_message?: string | null
          id?: string
          messages_composed?: number | null
          run_id?: string
          started_at?: string
          status?: string
          summary?: string | null
          triggered_by?: string | null
        }
        Update: {
          actions_taken?: number | null
          agent_name?: string
          completed_at?: string | null
          conditions_found?: number | null
          customers_scanned?: number | null
          error_message?: string | null
          id?: string
          messages_composed?: number | null
          run_id?: string
          started_at?: string
          status?: string
          summary?: string | null
          triggered_by?: string | null
        }
        Relationships: []
      }
      ar_aging_snapshots: {
        Row: {
          bucket_1_30: number
          bucket_1_30_count: number | null
          bucket_31_60: number
          bucket_31_60_count: number | null
          bucket_61_90: number
          bucket_61_90_count: number | null
          bucket_over_90: number
          bucket_over_90_count: number | null
          created_at: string | null
          credit_limit: number | null
          current_amount: number
          current_count: number | null
          customer_id: string
          generated_by: string | null
          id: string
          pre_petition_amount: number
          snapshot_date: string
          total_invoice_count: number | null
          total_outstanding: number | null
          utilization_pct: number | null
        }
        Insert: {
          bucket_1_30?: number
          bucket_1_30_count?: number | null
          bucket_31_60?: number
          bucket_31_60_count?: number | null
          bucket_61_90?: number
          bucket_61_90_count?: number | null
          bucket_over_90?: number
          bucket_over_90_count?: number | null
          created_at?: string | null
          credit_limit?: number | null
          current_amount?: number
          current_count?: number | null
          customer_id: string
          generated_by?: string | null
          id?: string
          pre_petition_amount?: number
          snapshot_date?: string
          total_invoice_count?: number | null
          total_outstanding?: number | null
          utilization_pct?: number | null
        }
        Update: {
          bucket_1_30?: number
          bucket_1_30_count?: number | null
          bucket_31_60?: number
          bucket_31_60_count?: number | null
          bucket_61_90?: number
          bucket_61_90_count?: number | null
          bucket_over_90?: number
          bucket_over_90_count?: number | null
          created_at?: string | null
          credit_limit?: number | null
          current_amount?: number
          current_count?: number | null
          customer_id?: string
          generated_by?: string | null
          id?: string
          pre_petition_amount?: number
          snapshot_date?: string
          total_invoice_count?: number | null
          total_outstanding?: number | null
          utilization_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ar_aging_snapshots_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_aging_snapshots_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_ar_aging_current"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "ar_aging_snapshots_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customers_at_risk"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_aging_snapshots_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_growth_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_aging_snapshots_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_payment_behaviour"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "ar_aging_snapshots_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_sec_monitoring_dashboard"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      bankruptcy_details: {
        Row: {
          asset_buyer: string | null
          asset_sale_date: string | null
          case_number: string
          chapter: number
          chapter7_conversion_date: string | null
          court: string | null
          created_at: string | null
          customer_id: string
          emergence_date_estimated: string | null
          estimated_recovery_amount: number | null
          estimated_recovery_rate: number | null
          filing_date: string
          id: string
          legal_counsel: string | null
          notes: string | null
          plan_confirmation_date: string | null
          proof_of_claim_amount: number | null
          proof_of_claim_date: string | null
          proof_of_claim_filed: boolean | null
          reorganization_advisor: string | null
          status: Database["public"]["Enums"]["bankruptcy_status"]
          total_pre_petition_claim: number | null
          trustee: string | null
          updated_at: string | null
        }
        Insert: {
          asset_buyer?: string | null
          asset_sale_date?: string | null
          case_number: string
          chapter: number
          chapter7_conversion_date?: string | null
          court?: string | null
          created_at?: string | null
          customer_id: string
          emergence_date_estimated?: string | null
          estimated_recovery_amount?: number | null
          estimated_recovery_rate?: number | null
          filing_date: string
          id?: string
          legal_counsel?: string | null
          notes?: string | null
          plan_confirmation_date?: string | null
          proof_of_claim_amount?: number | null
          proof_of_claim_date?: string | null
          proof_of_claim_filed?: boolean | null
          reorganization_advisor?: string | null
          status?: Database["public"]["Enums"]["bankruptcy_status"]
          total_pre_petition_claim?: number | null
          trustee?: string | null
          updated_at?: string | null
        }
        Update: {
          asset_buyer?: string | null
          asset_sale_date?: string | null
          case_number?: string
          chapter?: number
          chapter7_conversion_date?: string | null
          court?: string | null
          created_at?: string | null
          customer_id?: string
          emergence_date_estimated?: string | null
          estimated_recovery_amount?: number | null
          estimated_recovery_rate?: number | null
          filing_date?: string
          id?: string
          legal_counsel?: string | null
          notes?: string | null
          plan_confirmation_date?: string | null
          proof_of_claim_amount?: number | null
          proof_of_claim_date?: string | null
          proof_of_claim_filed?: boolean | null
          reorganization_advisor?: string | null
          status?: Database["public"]["Enums"]["bankruptcy_status"]
          total_pre_petition_claim?: number | null
          trustee?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bankruptcy_details_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bankruptcy_details_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "v_ar_aging_current"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "bankruptcy_details_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "v_customers_at_risk"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bankruptcy_details_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "v_growth_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bankruptcy_details_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "v_payment_behaviour"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "bankruptcy_details_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "v_sec_monitoring_dashboard"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      company: {
        Row: {
          annual_revenue: number | null
          base_currency: string | null
          created_at: string | null
          description: string | null
          employees: number | null
          fiscal_year_end_month: number | null
          founded: number | null
          headquarters: string | null
          id: string
          industry: string | null
          max_single_customer_exposure_pct: number | null
          name: string
          review_trigger_days_overdue: number | null
          standard_payment_terms_days: number | null
          ticker: string | null
          total_portfolio_limit: number | null
          updated_at: string | null
          watch_list_trigger_days_overdue: number | null
        }
        Insert: {
          annual_revenue?: number | null
          base_currency?: string | null
          created_at?: string | null
          description?: string | null
          employees?: number | null
          fiscal_year_end_month?: number | null
          founded?: number | null
          headquarters?: string | null
          id?: string
          industry?: string | null
          max_single_customer_exposure_pct?: number | null
          name: string
          review_trigger_days_overdue?: number | null
          standard_payment_terms_days?: number | null
          ticker?: string | null
          total_portfolio_limit?: number | null
          updated_at?: string | null
          watch_list_trigger_days_overdue?: number | null
        }
        Update: {
          annual_revenue?: number | null
          base_currency?: string | null
          created_at?: string | null
          description?: string | null
          employees?: number | null
          fiscal_year_end_month?: number | null
          founded?: number | null
          headquarters?: string | null
          id?: string
          industry?: string | null
          max_single_customer_exposure_pct?: number | null
          name?: string
          review_trigger_days_overdue?: number | null
          standard_payment_terms_days?: number | null
          ticker?: string | null
          total_portfolio_limit?: number | null
          updated_at?: string | null
          watch_list_trigger_days_overdue?: number | null
        }
        Relationships: []
      }
      credit_actions: {
        Row: {
          action_date: string
          action_type: Database["public"]["Enums"]["credit_action_type"]
          agent_name: string | null
          claim_amount: number | null
          created_at: string | null
          customer_id: string
          description: string | null
          id: string
          new_limit: number | null
          old_limit: number | null
          performed_by: string | null
          requires_review: boolean | null
          reviewed_at: string | null
          reviewed_by: string | null
        }
        Insert: {
          action_date: string
          action_type: Database["public"]["Enums"]["credit_action_type"]
          agent_name?: string | null
          claim_amount?: number | null
          created_at?: string | null
          customer_id: string
          description?: string | null
          id?: string
          new_limit?: number | null
          old_limit?: number | null
          performed_by?: string | null
          requires_review?: boolean | null
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Update: {
          action_date?: string
          action_type?: Database["public"]["Enums"]["credit_action_type"]
          agent_name?: string | null
          claim_amount?: number | null
          created_at?: string | null
          customer_id?: string
          description?: string | null
          id?: string
          new_limit?: number | null
          old_limit?: number | null
          performed_by?: string | null
          requires_review?: boolean | null
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_actions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_actions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_ar_aging_current"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "credit_actions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customers_at_risk"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_actions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_growth_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_actions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_payment_behaviour"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "credit_actions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_sec_monitoring_dashboard"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      credit_events: {
        Row: {
          action_required: boolean | null
          action_status: string | null
          action_type: string | null
          archived_at: string | null
          cia_decision: string | null
          cia_processed: boolean | null
          cia_processed_at: string | null
          correlation_id: string | null
          created_at: string | null
          credit_rating_raw: string | null
          credit_rating_score: number | null
          credit_rating_source: string | null
          customer_id: string | null
          customer_ids: string[] | null
          description: string | null
          event_type: string
          id: string
          is_demo: boolean
          new_value: number | null
          parent_event_id: string | null
          payload: Json
          previous_value: number | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          run_id: string | null
          scope: string
          severity: string
          severity_score: number | null
          signal_type: string | null
          source_agent: string
          summary: string | null
          title: string
          updated_at: string | null
          value_type: string | null
        }
        Insert: {
          action_required?: boolean | null
          action_status?: string | null
          action_type?: string | null
          archived_at?: string | null
          cia_decision?: string | null
          cia_processed?: boolean | null
          cia_processed_at?: string | null
          correlation_id?: string | null
          created_at?: string | null
          credit_rating_raw?: string | null
          credit_rating_score?: number | null
          credit_rating_source?: string | null
          customer_id?: string | null
          customer_ids?: string[] | null
          description?: string | null
          event_type: string
          id?: string
          is_demo?: boolean
          new_value?: number | null
          parent_event_id?: string | null
          payload?: Json
          previous_value?: number | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          run_id?: string | null
          scope?: string
          severity: string
          severity_score?: number | null
          signal_type?: string | null
          source_agent: string
          summary?: string | null
          title: string
          updated_at?: string | null
          value_type?: string | null
        }
        Update: {
          action_required?: boolean | null
          action_status?: string | null
          action_type?: string | null
          archived_at?: string | null
          cia_decision?: string | null
          cia_processed?: boolean | null
          cia_processed_at?: string | null
          correlation_id?: string | null
          created_at?: string | null
          credit_rating_raw?: string | null
          credit_rating_score?: number | null
          credit_rating_source?: string | null
          customer_id?: string | null
          customer_ids?: string[] | null
          description?: string | null
          event_type?: string
          id?: string
          is_demo?: boolean
          new_value?: number | null
          parent_event_id?: string | null
          payload?: Json
          previous_value?: number | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          run_id?: string | null
          scope?: string
          severity?: string
          severity_score?: number | null
          signal_type?: string | null
          source_agent?: string
          summary?: string | null
          title?: string
          updated_at?: string | null
          value_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_ar_aging_current"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "credit_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customers_at_risk"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_growth_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_payment_behaviour"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "credit_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_sec_monitoring_dashboard"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "credit_events_parent_fk"
            columns: ["parent_event_id"]
            isOneToOne: false
            referencedRelation: "credit_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_metric_changes: {
        Row: {
          agent_name: string | null
          change_date: string
          created_at: string | null
          customer_id: string
          id: string
          metric_name: string
          new_value: number | null
          old_value: number | null
          source: string | null
        }
        Insert: {
          agent_name?: string | null
          change_date: string
          created_at?: string | null
          customer_id: string
          id?: string
          metric_name: string
          new_value?: number | null
          old_value?: number | null
          source?: string | null
        }
        Update: {
          agent_name?: string | null
          change_date?: string
          created_at?: string | null
          customer_id?: string
          id?: string
          metric_name?: string
          new_value?: number | null
          old_value?: number | null
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_metric_changes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_metric_changes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_ar_aging_current"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "credit_metric_changes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customers_at_risk"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_metric_changes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_growth_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_metric_changes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_payment_behaviour"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "credit_metric_changes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_sec_monitoring_dashboard"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      credit_metrics: {
        Row: {
          altman_z_score: number | null
          burn_rate_quarterly: number | null
          cash_on_hand: number | null
          created_at: string | null
          credit_score: number | null
          current_ratio: number | null
          customer_id: string
          d_and_b_failure_score: number | null
          d_and_b_rating: string | null
          debt_to_equity: number | null
          financials_source: string | null
          id: string
          interest_coverage: number | null
          last_financials_date: string | null
          parent_company_guarantee: boolean | null
          private_company: boolean | null
          quick_ratio: number | null
          total_debt: number | null
          updated_at: string | null
        }
        Insert: {
          altman_z_score?: number | null
          burn_rate_quarterly?: number | null
          cash_on_hand?: number | null
          created_at?: string | null
          credit_score?: number | null
          current_ratio?: number | null
          customer_id: string
          d_and_b_failure_score?: number | null
          d_and_b_rating?: string | null
          debt_to_equity?: number | null
          financials_source?: string | null
          id?: string
          interest_coverage?: number | null
          last_financials_date?: string | null
          parent_company_guarantee?: boolean | null
          private_company?: boolean | null
          quick_ratio?: number | null
          total_debt?: number | null
          updated_at?: string | null
        }
        Update: {
          altman_z_score?: number | null
          burn_rate_quarterly?: number | null
          cash_on_hand?: number | null
          created_at?: string | null
          credit_score?: number | null
          current_ratio?: number | null
          customer_id?: string
          d_and_b_failure_score?: number | null
          d_and_b_rating?: string | null
          debt_to_equity?: number | null
          financials_source?: string | null
          id?: string
          interest_coverage?: number | null
          last_financials_date?: string | null
          parent_company_guarantee?: boolean | null
          private_company?: boolean | null
          quick_ratio?: number | null
          total_debt?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_metrics_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_metrics_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "v_ar_aging_current"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "credit_metrics_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "v_customers_at_risk"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_metrics_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "v_growth_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_metrics_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "v_payment_behaviour"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "credit_metrics_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "v_sec_monitoring_dashboard"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      customer_identifiers: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          id_type: string
          id_value: string
          is_primary: boolean
          source: string
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          id_type: string
          id_value: string
          is_primary?: boolean
          source: string
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          id_type?: string
          id_value?: string
          is_primary?: boolean
          source?: string
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_identifiers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_identifiers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_ar_aging_current"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_identifiers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customers_at_risk"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_identifiers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_growth_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_identifiers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_payment_behaviour"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_identifiers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_sec_monitoring_dashboard"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      customers: {
        Row: {
          account_manager: string | null
          company_name: string
          company_type: string | null
          contract_expiry: string | null
          country_code: string
          created_at: string | null
          credit_limit: number
          credit_rating_previous_score: number | null
          credit_rating_raw: string | null
          credit_rating_score: number | null
          credit_rating_source: string | null
          credit_rating_updated_at: string | null
          current_exposure: number
          customer_since: string | null
          headquarters: string | null
          id: string
          industry: string | null
          last_reviewed: string | null
          market_cap_tier: Database["public"]["Enums"]["market_cap_tier"] | null
          market_cap_usd: number | null
          notes: string | null
          payment_avg_days_early_late: number | null
          payment_behaviour_updated_at: string | null
          payment_health: string | null
          payment_on_time_rate: number | null
          payment_terms_days: number
          payment_trend: string | null
          preferred_customer: boolean | null
          primary_contact: string | null
          primary_products: string[] | null
          risk_tags: string[] | null
          risk_tags_updated_at: string | null
          scenario: Database["public"]["Enums"]["scenario_type"]
          sector: string
          updated_at: string | null
        }
        Insert: {
          account_manager?: string | null
          company_name: string
          company_type?: string | null
          contract_expiry?: string | null
          country_code?: string
          created_at?: string | null
          credit_limit?: number
          credit_rating_previous_score?: number | null
          credit_rating_raw?: string | null
          credit_rating_score?: number | null
          credit_rating_source?: string | null
          credit_rating_updated_at?: string | null
          current_exposure?: number
          customer_since?: string | null
          headquarters?: string | null
          id?: string
          industry?: string | null
          last_reviewed?: string | null
          market_cap_tier?:
            | Database["public"]["Enums"]["market_cap_tier"]
            | null
          market_cap_usd?: number | null
          notes?: string | null
          payment_avg_days_early_late?: number | null
          payment_behaviour_updated_at?: string | null
          payment_health?: string | null
          payment_on_time_rate?: number | null
          payment_terms_days?: number
          payment_trend?: string | null
          preferred_customer?: boolean | null
          primary_contact?: string | null
          primary_products?: string[] | null
          risk_tags?: string[] | null
          risk_tags_updated_at?: string | null
          scenario?: Database["public"]["Enums"]["scenario_type"]
          sector: string
          updated_at?: string | null
        }
        Update: {
          account_manager?: string | null
          company_name?: string
          company_type?: string | null
          contract_expiry?: string | null
          country_code?: string
          created_at?: string | null
          credit_limit?: number
          credit_rating_previous_score?: number | null
          credit_rating_raw?: string | null
          credit_rating_score?: number | null
          credit_rating_source?: string | null
          credit_rating_updated_at?: string | null
          current_exposure?: number
          customer_since?: string | null
          headquarters?: string | null
          id?: string
          industry?: string | null
          last_reviewed?: string | null
          market_cap_tier?:
            | Database["public"]["Enums"]["market_cap_tier"]
            | null
          market_cap_usd?: number | null
          notes?: string | null
          payment_avg_days_early_late?: number | null
          payment_behaviour_updated_at?: string | null
          payment_health?: string | null
          payment_on_time_rate?: number | null
          payment_terms_days?: number
          payment_trend?: string | null
          preferred_customer?: boolean | null
          primary_contact?: string | null
          primary_products?: string[] | null
          risk_tags?: string[] | null
          risk_tags_updated_at?: string | null
          scenario?: Database["public"]["Enums"]["scenario_type"]
          sector?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      growth_signals: {
        Row: {
          agent_name: string | null
          backlog_amount: number | null
          backlog_description: string | null
          created_at: string | null
          credit_limit_increase_recommended: boolean | null
          customer_id: string
          growth_trajectory: string | null
          id: string
          rationale: string | null
          recent_milestones: string[] | null
          recommended_new_limit: number | null
          revenue_growth_yoy: number | null
          updated_at: string | null
          upsell_opportunity: string | null
        }
        Insert: {
          agent_name?: string | null
          backlog_amount?: number | null
          backlog_description?: string | null
          created_at?: string | null
          credit_limit_increase_recommended?: boolean | null
          customer_id: string
          growth_trajectory?: string | null
          id?: string
          rationale?: string | null
          recent_milestones?: string[] | null
          recommended_new_limit?: number | null
          revenue_growth_yoy?: number | null
          updated_at?: string | null
          upsell_opportunity?: string | null
        }
        Update: {
          agent_name?: string | null
          backlog_amount?: number | null
          backlog_description?: string | null
          created_at?: string | null
          credit_limit_increase_recommended?: boolean | null
          customer_id?: string
          growth_trajectory?: string | null
          id?: string
          rationale?: string | null
          recent_milestones?: string[] | null
          recommended_new_limit?: number | null
          revenue_growth_yoy?: number | null
          updated_at?: string | null
          upsell_opportunity?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "growth_signals_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growth_signals_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "v_ar_aging_current"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "growth_signals_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "v_customers_at_risk"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growth_signals_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "v_growth_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growth_signals_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "v_payment_behaviour"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "growth_signals_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "v_sec_monitoring_dashboard"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_outstanding: number | null
          amount_paid: number
          claimable: boolean | null
          created_at: string | null
          currency: string | null
          customer_id: string
          days_overdue: number
          due_date: string
          dunning_sent_date: string | null
          dunning_stage: Database["public"]["Enums"]["dunning_stage"] | null
          escalated_to_collections: boolean | null
          id: string
          invoice_amount: number
          invoice_date: string | null
          invoice_number: string
          is_demo: boolean
          outstanding_amount: number
          product_description: string | null
          purchase_order_number: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          updated_at: string | null
          upload_source: string | null
          uploaded_at: string | null
        }
        Insert: {
          amount_outstanding?: number | null
          amount_paid?: number
          claimable?: boolean | null
          created_at?: string | null
          currency?: string | null
          customer_id: string
          days_overdue?: number
          due_date: string
          dunning_sent_date?: string | null
          dunning_stage?: Database["public"]["Enums"]["dunning_stage"] | null
          escalated_to_collections?: boolean | null
          id?: string
          invoice_amount: number
          invoice_date?: string | null
          invoice_number: string
          is_demo?: boolean
          outstanding_amount?: number
          product_description?: string | null
          purchase_order_number?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          updated_at?: string | null
          upload_source?: string | null
          uploaded_at?: string | null
        }
        Update: {
          amount_outstanding?: number | null
          amount_paid?: number
          claimable?: boolean | null
          created_at?: string | null
          currency?: string | null
          customer_id?: string
          days_overdue?: number
          due_date?: string
          dunning_sent_date?: string | null
          dunning_stage?: Database["public"]["Enums"]["dunning_stage"] | null
          escalated_to_collections?: boolean | null
          id?: string
          invoice_amount?: number
          invoice_date?: string | null
          invoice_number?: string
          is_demo?: boolean
          outstanding_amount?: number
          product_description?: string | null
          purchase_order_number?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          updated_at?: string | null
          upload_source?: string | null
          uploaded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_ar_aging_current"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customers_at_risk"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_growth_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_payment_behaviour"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_sec_monitoring_dashboard"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      negative_news: {
        Row: {
          action_taken: string | null
          agent_name: string | null
          category: string | null
          classification_source: string | null
          confidence: number | null
          content_fingerprint: string | null
          created_at: string | null
          customer_id: string
          headline: string
          id: string
          is_demo: boolean
          news_date: string
          provider: string | null
          relevance_score: number | null
          reviewed: boolean | null
          reviewed_at: string | null
          reviewed_by: string | null
          sentiment_score: number | null
          severity: string | null
          source: string | null
          summary: string | null
          url: string | null
        }
        Insert: {
          action_taken?: string | null
          agent_name?: string | null
          category?: string | null
          classification_source?: string | null
          confidence?: number | null
          content_fingerprint?: string | null
          created_at?: string | null
          customer_id: string
          headline: string
          id?: string
          is_demo?: boolean
          news_date: string
          provider?: string | null
          relevance_score?: number | null
          reviewed?: boolean | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sentiment_score?: number | null
          severity?: string | null
          source?: string | null
          summary?: string | null
          url?: string | null
        }
        Update: {
          action_taken?: string | null
          agent_name?: string | null
          category?: string | null
          classification_source?: string | null
          confidence?: number | null
          content_fingerprint?: string | null
          created_at?: string | null
          customer_id?: string
          headline?: string
          id?: string
          is_demo?: boolean
          news_date?: string
          provider?: string | null
          relevance_score?: number | null
          reviewed?: boolean | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sentiment_score?: number | null
          severity?: string | null
          source?: string | null
          summary?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "negative_news_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negative_news_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_ar_aging_current"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "negative_news_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customers_at_risk"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negative_news_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_growth_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negative_news_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_payment_behaviour"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "negative_news_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_sec_monitoring_dashboard"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      payment_transactions: {
        Row: {
          amount_paid: number
          created_at: string | null
          customer_id: string
          days_early_late: number | null
          days_to_pay: number | null
          id: string
          invoice_date: string | null
          invoice_due_date: string | null
          invoice_id: string | null
          invoice_number: string | null
          is_demo: boolean
          is_partial_payment: boolean | null
          notes: string | null
          on_time: boolean | null
          payment_date: string
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          posted_by: string | null
          reference_number: string | null
        }
        Insert: {
          amount_paid: number
          created_at?: string | null
          customer_id: string
          days_early_late?: number | null
          days_to_pay?: number | null
          id?: string
          invoice_date?: string | null
          invoice_due_date?: string | null
          invoice_id?: string | null
          invoice_number?: string | null
          is_demo?: boolean
          is_partial_payment?: boolean | null
          notes?: string | null
          on_time?: boolean | null
          payment_date: string
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          posted_by?: string | null
          reference_number?: string | null
        }
        Update: {
          amount_paid?: number
          created_at?: string | null
          customer_id?: string
          days_early_late?: number | null
          days_to_pay?: number | null
          id?: string
          invoice_date?: string | null
          invoice_due_date?: string | null
          invoice_id?: string | null
          invoice_number?: string | null
          is_demo?: boolean
          is_partial_payment?: boolean | null
          notes?: string | null
          on_time?: boolean | null
          payment_date?: string
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          posted_by?: string | null
          reference_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_ar_aging_current"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "payment_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customers_at_risk"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_growth_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_payment_behaviour"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "payment_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_sec_monitoring_dashboard"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "payment_transactions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_actions: {
        Row: {
          action_type: string
          agent_name: string
          created_at: string
          current_value: number | null
          customer_id: string
          expires_at: string | null
          id: string
          is_demo: boolean
          message_id: string | null
          proposed_value: number | null
          rationale: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          run_id: string
          status: string
        }
        Insert: {
          action_type: string
          agent_name: string
          created_at?: string
          current_value?: number | null
          customer_id: string
          expires_at?: string | null
          id?: string
          is_demo?: boolean
          message_id?: string | null
          proposed_value?: number | null
          rationale: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          run_id: string
          status?: string
        }
        Update: {
          action_type?: string
          agent_name?: string
          created_at?: string
          current_value?: number | null
          customer_id?: string
          expires_at?: string | null
          id?: string
          is_demo?: boolean
          message_id?: string | null
          proposed_value?: number | null
          rationale?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          run_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_actions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_actions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_ar_aging_current"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "pending_actions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customers_at_risk"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_actions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_growth_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_actions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_payment_behaviour"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "pending_actions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_sec_monitoring_dashboard"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "pending_actions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "agent_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_actions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      sec_filings: {
        Row: {
          accession_number: string | null
          agent_name: string | null
          cik: string | null
          created_at: string | null
          customer_id: string
          document_url: string | null
          filing_date: string
          filing_type: string
          id: string
          is_demo: boolean
          key_findings: string | null
          provider: string | null
          reviewed: boolean | null
          reviewed_at: string | null
          reviewed_by: string | null
          risk_signals: string[] | null
          url: string | null
        }
        Insert: {
          accession_number?: string | null
          agent_name?: string | null
          cik?: string | null
          created_at?: string | null
          customer_id: string
          document_url?: string | null
          filing_date: string
          filing_type: string
          id?: string
          is_demo?: boolean
          key_findings?: string | null
          provider?: string | null
          reviewed?: boolean | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_signals?: string[] | null
          url?: string | null
        }
        Update: {
          accession_number?: string | null
          agent_name?: string | null
          cik?: string | null
          created_at?: string | null
          customer_id?: string
          document_url?: string | null
          filing_date?: string
          filing_type?: string
          id?: string
          is_demo?: boolean
          key_findings?: string | null
          provider?: string | null
          reviewed?: boolean | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_signals?: string[] | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sec_filings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sec_filings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_ar_aging_current"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "sec_filings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customers_at_risk"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sec_filings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_growth_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sec_filings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_payment_behaviour"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "sec_filings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_sec_monitoring_dashboard"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      sec_monitoring: {
        Row: {
          alert_action_taken: string | null
          alert_date: string | null
          alert_triggered: boolean | null
          cik: string
          created_at: string | null
          customer_id: string
          filing_types_monitored: string[] | null
          id: string
          is_demo: boolean
          last_10k_date: string | null
          last_10q_date: string | null
          last_8k_date: string | null
          last_checked_at: string | null
          monitoring_active: boolean | null
          next_scheduled_review: string | null
          risk_signals_detected: string[] | null
          updated_at: string | null
        }
        Insert: {
          alert_action_taken?: string | null
          alert_date?: string | null
          alert_triggered?: boolean | null
          cik: string
          created_at?: string | null
          customer_id: string
          filing_types_monitored?: string[] | null
          id?: string
          is_demo?: boolean
          last_10k_date?: string | null
          last_10q_date?: string | null
          last_8k_date?: string | null
          last_checked_at?: string | null
          monitoring_active?: boolean | null
          next_scheduled_review?: string | null
          risk_signals_detected?: string[] | null
          updated_at?: string | null
        }
        Update: {
          alert_action_taken?: string | null
          alert_date?: string | null
          alert_triggered?: boolean | null
          cik?: string
          created_at?: string | null
          customer_id?: string
          filing_types_monitored?: string[] | null
          id?: string
          is_demo?: boolean
          last_10k_date?: string | null
          last_10q_date?: string | null
          last_8k_date?: string | null
          last_checked_at?: string | null
          monitoring_active?: boolean | null
          next_scheduled_review?: string | null
          risk_signals_detected?: string[] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sec_monitoring_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sec_monitoring_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "v_ar_aging_current"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "sec_monitoring_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "v_customers_at_risk"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sec_monitoring_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "v_growth_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sec_monitoring_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "v_payment_behaviour"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "sec_monitoring_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "v_sec_monitoring_dashboard"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      seed_news: {
        Row: {
          company_name: string
          created_at: string
          customer_id: string
          headline: string
          id: string
          provider: string
          published_date: string
          relevance_score: number
          source: string
          summary: string
          url: string | null
        }
        Insert: {
          company_name: string
          created_at?: string
          customer_id: string
          headline: string
          id?: string
          provider?: string
          published_date: string
          relevance_score?: number
          source: string
          summary: string
          url?: string | null
        }
        Update: {
          company_name?: string
          created_at?: string
          customer_id?: string
          headline?: string
          id?: string
          provider?: string
          published_date?: string
          relevance_score?: number
          source?: string
          summary?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "seed_news_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seed_news_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_ar_aging_current"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "seed_news_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customers_at_risk"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seed_news_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_growth_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seed_news_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_payment_behaviour"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "seed_news_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_sec_monitoring_dashboard"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      seed_sec_filings: {
        Row: {
          accession_number: string
          cik: string
          company_name: string
          created_at: string
          document_url: string
          filing_date: string
          filing_type: string
          id: string
          key_findings: string
          provider: string
          risk_signals: string[]
        }
        Insert: {
          accession_number: string
          cik: string
          company_name: string
          created_at?: string
          document_url: string
          filing_date: string
          filing_type: string
          id?: string
          key_findings?: string
          provider?: string
          risk_signals?: string[]
        }
        Update: {
          accession_number?: string
          cik?: string
          company_name?: string
          created_at?: string
          document_url?: string
          filing_date?: string
          filing_type?: string
          id?: string
          key_findings?: string
          provider?: string
          risk_signals?: string[]
        }
        Relationships: []
      }
    }
    Views: {
      v_ar_aging_current: {
        Row: {
          account_manager: string | null
          bucket_1_30: number | null
          bucket_1_30_count: number | null
          bucket_31_60: number | null
          bucket_31_60_count: number | null
          bucket_61_90: number | null
          bucket_61_90_count: number | null
          bucket_over_90: number | null
          bucket_over_90_count: number | null
          company_name: string | null
          credit_limit: number | null
          current_amount: number | null
          current_count: number | null
          customer_id: string | null
          payment_terms_days: number | null
          pre_petition_amount: number | null
          risk_tier: string | null
          scenario: Database["public"]["Enums"]["scenario_type"] | null
          snapshot_date: string | null
          ticker: string | null
          total_invoice_count: number | null
          total_outstanding: number | null
          utilization_pct: number | null
        }
        Relationships: []
      }
      v_ar_aging_portfolio: {
        Row: {
          customer_count: number | null
          pct_1_30: number | null
          pct_31_60: number | null
          pct_61_90: number | null
          pct_current: number | null
          pct_over_90: number | null
          snapshot_date: string | null
          total_1_30: number | null
          total_31_60: number | null
          total_61_90: number | null
          total_current: number | null
          total_outstanding: number | null
          total_over_90: number | null
          total_pre_petition: number | null
        }
        Relationships: []
      }
      v_bankruptcy_claims: {
        Row: {
          case_number: string | null
          chapter: number | null
          claimable_invoice_count: number | null
          claimable_total: number | null
          company_name: string | null
          court: string | null
          emergence_date_estimated: string | null
          estimated_recovery_amount: number | null
          estimated_recovery_rate: number | null
          filing_date: string | null
          proof_of_claim_amount: number | null
          proof_of_claim_filed: boolean | null
          status: Database["public"]["Enums"]["bankruptcy_status"] | null
          ticker: string | null
          total_pre_petition_claim: number | null
        }
        Relationships: []
      }
      v_customers_at_risk: {
        Row: {
          account_manager: string | null
          avg_days_early_late: number | null
          company_name: string | null
          credit_limit: number | null
          credit_rating_score: number | null
          current_exposure: number | null
          id: string | null
          max_days_overdue: number | null
          notes: string | null
          on_time_pct: number | null
          overdue_amount: number | null
          overdue_invoice_count: number | null
          scenario: Database["public"]["Enums"]["scenario_type"] | null
          ticker: string | null
          utilization_pct: number | null
        }
        Relationships: []
      }
      v_growth_opportunities: {
        Row: {
          account_manager: string | null
          backlog_amount: number | null
          company_name: string | null
          credit_limit: number | null
          current_exposure: number | null
          growth_trajectory: string | null
          id: string | null
          rationale: string | null
          recent_milestones: string[] | null
          recommended_new_limit: number | null
          revenue_growth_yoy: number | null
          ticker: string | null
          upsell_opportunity: string | null
        }
        Relationships: []
      }
      v_overdue_invoices: {
        Row: {
          account_manager: string | null
          amount_outstanding: number | null
          amount_paid: number | null
          claimable: boolean | null
          company_name: string | null
          days_overdue: number | null
          due_date: string | null
          dunning_stage: Database["public"]["Enums"]["dunning_stage"] | null
          escalated_to_collections: boolean | null
          invoice_amount: number | null
          invoice_date: string | null
          invoice_number: string | null
          risk_tier: string | null
          scenario: Database["public"]["Enums"]["scenario_type"] | null
          status: Database["public"]["Enums"]["invoice_status"] | null
          ticker: string | null
        }
        Relationships: []
      }
      v_payment_behaviour: {
        Row: {
          account_manager: string | null
          avg_days_early_late: number | null
          avg_days_to_pay: number | null
          avg_days_to_pay_last_6mo: number | null
          avg_days_to_pay_prior_6mo: number | null
          company_name: string | null
          customer_id: string | null
          last_payment_amount: number | null
          last_payment_date: string | null
          on_time_payment_pct: number | null
          payment_terms_days: number | null
          ticker: string | null
          total_paid_12mo: number | null
          total_paid_all_time: number | null
          total_payments: number | null
        }
        Relationships: []
      }
      v_portfolio_overview: {
        Row: {
          avg_credit_limit: number | null
          bankruptcy_count: number | null
          credit_deterioration_count: number | null
          growth_count: number | null
          high_risk_count: number | null
          negative_news_count: number | null
          normal_count: number | null
          payment_issues_count: number | null
          portfolio_utilization_pct: number | null
          sec_monitoring_count: number | null
          total_credit_limits: number | null
          total_customers: number | null
          total_exposure: number | null
        }
        Relationships: []
      }
      v_sec_monitoring_dashboard: {
        Row: {
          alert_action_taken: string | null
          alert_date: string | null
          alert_triggered: boolean | null
          cik: string | null
          company_name: string | null
          customer_id: string | null
          last_10k_date: string | null
          last_10q_date: string | null
          last_8k_date: string | null
          monitoring_active: boolean | null
          next_scheduled_review: string | null
          risk_signals_detected: string[] | null
          ticker: string | null
          total_filings: number | null
          unreviewed_filings: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      fn_rank_portfolio_risk: {
        Args: never
        Returns: {
          company_name: string
          company_type: string
          credit_limit: number
          credit_rating_raw: string
          credit_rating_score: number
          credit_rating_source: string
          current_exposure: number
          id: string
          is_high_risk: boolean
          latest_event_date: string
          payment_health: string
          payment_on_time_rate: number
          payment_trend: string
          recent_severity_sum: number
          risk_tags: string[]
          scenario: Database["public"]["Enums"]["scenario_type"]
        }[]
      }
      fn_recalculate_exposure: {
        Args: { p_customer_id: string }
        Returns: undefined
      }
      fn_refresh_all_ar_aging: { Args: { p_as_of?: string }; Returns: number }
      fn_refresh_ar_aging: {
        Args: { p_as_of?: string; p_customer_id: string }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      bankruptcy_status:
        | "FILED"
        | "CONFIRMED_PLAN"
        | "CHAPTER_7_CONVERTED"
        | "ASSETS_SOLD"
        | "EMERGED"
        | "DISMISSED"
      credit_action_type:
        | "PLACED_ON_WATCH_LIST"
        | "REMOVED_FROM_WATCH_LIST"
        | "CREDIT_HOLD_PLACED"
        | "CREDIT_HOLD_RELEASED"
        | "CREDIT_LIMIT_REDUCTION"
        | "CREDIT_LIMIT_INCREASE"
        | "CREDIT_LIMIT_REVIEW"
        | "DUNNING_LETTER_STAGE_1"
        | "DUNNING_LETTER_STAGE_2"
        | "DUNNING_LETTER_STAGE_3"
        | "DUNNING_LETTER_STAGE_4"
        | "REFERRED_TO_COLLECTIONS"
        | "PROOF_OF_CLAIM_FILED"
        | "COD_ONLY_POLICY_SET"
        | "PARENT_GUARANTEE_REQUEST_SENT"
        | "CREDIT_REVIEW_INITIATED"
        | "LEGAL_COUNSEL_ENGAGED"
        | "PAYMENT_PLAN_DISCUSSION"
        | "PAYMENT_PLAN_AGREED"
        | "SEC_ALERT_TRIGGERED"
        | "NEWS_ALERT_TRIGGERED"
        | "NEWS_MONITORING_INCREASED"
        | "FINANCIALS_REQUEST_SENT"
        | "EXECUTIVE_ESCALATION"
        | "OTHER"
      credit_event_type:
        | "RATING_DOWNGRADE"
        | "RATING_UPGRADE"
        | "OUTLOOK_CHANGE"
        | "EARNINGS_MISS"
        | "EARNINGS_BEAT"
        | "COVENANT_WAIVER"
        | "COVENANT_BREACH"
        | "RESTRUCTURING_ANNOUNCEMENT"
        | "MANAGEMENT_CHANGE"
        | "OWNERSHIP_CHANGE"
        | "SEC_INVESTIGATION"
        | "GOODWILL_IMPAIRMENT"
        | "CAPITAL_RAISE"
        | "LOAN_AMENDMENT"
        | "CONTRACT_LOSS"
        | "CONTRACT_WIN"
        | "GOING_CONCERN"
        | "CREDIT_FACILITY_AMENDMENT"
        | "OTHER"
      dunning_stage: "1" | "2" | "3" | "4"
      invoice_status:
        | "current"
        | "overdue"
        | "pre_petition"
        | "paid"
        | "written_off"
        | "disputed"
        | "open"
      market_cap_tier:
        | "large_cap"
        | "mid_cap"
        | "small_cap"
        | "private"
        | "private_subsidiary"
      payment_method:
        | "wire_transfer"
        | "ach"
        | "check"
        | "credit_card"
        | "offset"
        | "partial"
        | "other"
        | "wire"
      scenario_type:
        | "normal_operations"
        | "payment_issues"
        | "credit_deterioration"
        | "negative_news"
        | "bankruptcy"
        | "growth_opportunity"
        | "sec_filing_monitoring"
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
      bankruptcy_status: [
        "FILED",
        "CONFIRMED_PLAN",
        "CHAPTER_7_CONVERTED",
        "ASSETS_SOLD",
        "EMERGED",
        "DISMISSED",
      ],
      credit_action_type: [
        "PLACED_ON_WATCH_LIST",
        "REMOVED_FROM_WATCH_LIST",
        "CREDIT_HOLD_PLACED",
        "CREDIT_HOLD_RELEASED",
        "CREDIT_LIMIT_REDUCTION",
        "CREDIT_LIMIT_INCREASE",
        "CREDIT_LIMIT_REVIEW",
        "DUNNING_LETTER_STAGE_1",
        "DUNNING_LETTER_STAGE_2",
        "DUNNING_LETTER_STAGE_3",
        "DUNNING_LETTER_STAGE_4",
        "REFERRED_TO_COLLECTIONS",
        "PROOF_OF_CLAIM_FILED",
        "COD_ONLY_POLICY_SET",
        "PARENT_GUARANTEE_REQUEST_SENT",
        "CREDIT_REVIEW_INITIATED",
        "LEGAL_COUNSEL_ENGAGED",
        "PAYMENT_PLAN_DISCUSSION",
        "PAYMENT_PLAN_AGREED",
        "SEC_ALERT_TRIGGERED",
        "NEWS_ALERT_TRIGGERED",
        "NEWS_MONITORING_INCREASED",
        "FINANCIALS_REQUEST_SENT",
        "EXECUTIVE_ESCALATION",
        "OTHER",
      ],
      credit_event_type: [
        "RATING_DOWNGRADE",
        "RATING_UPGRADE",
        "OUTLOOK_CHANGE",
        "EARNINGS_MISS",
        "EARNINGS_BEAT",
        "COVENANT_WAIVER",
        "COVENANT_BREACH",
        "RESTRUCTURING_ANNOUNCEMENT",
        "MANAGEMENT_CHANGE",
        "OWNERSHIP_CHANGE",
        "SEC_INVESTIGATION",
        "GOODWILL_IMPAIRMENT",
        "CAPITAL_RAISE",
        "LOAN_AMENDMENT",
        "CONTRACT_LOSS",
        "CONTRACT_WIN",
        "GOING_CONCERN",
        "CREDIT_FACILITY_AMENDMENT",
        "OTHER",
      ],
      dunning_stage: ["1", "2", "3", "4"],
      invoice_status: [
        "current",
        "overdue",
        "pre_petition",
        "paid",
        "written_off",
        "disputed",
        "open",
      ],
      market_cap_tier: [
        "large_cap",
        "mid_cap",
        "small_cap",
        "private",
        "private_subsidiary",
      ],
      payment_method: [
        "wire_transfer",
        "ach",
        "check",
        "credit_card",
        "offset",
        "partial",
        "other",
        "wire",
      ],
      scenario_type: [
        "normal_operations",
        "payment_issues",
        "credit_deterioration",
        "negative_news",
        "bankruptcy",
        "growth_opportunity",
        "sec_filing_monitoring",
      ],
    },
  },
} as const
