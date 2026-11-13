
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "agent_messages": {
                  Row: {
                    "agent_name": string,"body": string,"channel": string,"created_at": string,"customer_id": string,"delivered_via": string | null,"id": string,"invoice_ids": (string)[] | null,"is_demo": boolean,"metadata": Json | null,"recipient_email": string | null,"recipient_name": string | null,"recipient_type": string,"run_id": string,"sent_at": string | null,"status": string,"subject": string | null,"template_type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agent_name": string,"body": string,"channel"?: string,"created_at"?: string,"customer_id": string,"delivered_via"?: string | null,"id"?: string,"invoice_ids"?: (string)[] | null,"is_demo"?: boolean,"metadata"?: Json | null,"recipient_email"?: string | null,"recipient_name"?: string | null,"recipient_type"?: string,"run_id": string,"sent_at"?: string | null,"status"?: string,"subject"?: string | null,"template_type": string
                  }
                  Update: {
                    "agent_name"?: string,"body"?: string,"channel"?: string,"created_at"?: string,"customer_id"?: string,"delivered_via"?: string | null,"id"?: string,"invoice_ids"?: (string)[] | null,"is_demo"?: boolean,"metadata"?: Json | null,"recipient_email"?: string | null,"recipient_name"?: string | null,"recipient_type"?: string,"run_id"?: string,"sent_at"?: string | null,"status"?: string,"subject"?: string | null,"template_type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "agent_messages_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agent_messages_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_ar_aging_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "agent_messages_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_customers_at_risk"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agent_messages_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_growth_opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agent_messages_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_payment_behaviour"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "agent_messages_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_payment_behaviour_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "agent_messages_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_sec_monitoring_dashboard"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "agent_messages_run_id_fkey"
      columns: ["run_id"]
isOneToOne: false
      referencedRelation: "agent_runs"
      referencedColumns: ["id"]
    }
                  ]
                },"agent_processed_events": {
                  Row: {
                    "agent_name": string,"event_id": string,"processed_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agent_name": string,"event_id": string,"processed_at"?: string
                  }
                  Update: {
                    "agent_name"?: string,"event_id"?: string,"processed_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "agent_processed_events_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "credit_events"
      referencedColumns: ["id"]
    }
                  ]
                },"agent_runs": {
                  Row: {
                    "actions_taken": number | null,"agent_name": string,"completed_at": string | null,"conditions_found": number | null,"customers_scanned": number | null,"error_message": string | null,"id": string,"messages_composed": number | null,"run_id": string,"started_at": string,"status": string,"summary": string | null,"triggered_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "actions_taken"?: number | null,"agent_name": string,"completed_at"?: string | null,"conditions_found"?: number | null,"customers_scanned"?: number | null,"error_message"?: string | null,"id"?: string,"messages_composed"?: number | null,"run_id"?: string,"started_at"?: string,"status"?: string,"summary"?: string | null,"triggered_by"?: string | null
                  }
                  Update: {
                    "actions_taken"?: number | null,"agent_name"?: string,"completed_at"?: string | null,"conditions_found"?: number | null,"customers_scanned"?: number | null,"error_message"?: string | null,"id"?: string,"messages_composed"?: number | null,"run_id"?: string,"started_at"?: string,"status"?: string,"summary"?: string | null,"triggered_by"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"app_users": {
                  Row: {
                    "active": boolean,"created_at": string,"display_name": string,"email": string,"is_demo": boolean,"role": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"display_name": string,"email": string,"is_demo"?: boolean,"role": string,"user_id": string
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"display_name"?: string,"email"?: string,"is_demo"?: boolean,"role"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"application_documents": {
                  Row: {
                    "application_id": string,"confirmed_at": string | null,"confirmed_by": string | null,"created_at": string,"doc_type": string,"extraction": Json | null,"filename": string,"id": string,"storage_path": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "application_id": string,"confirmed_at"?: string | null,"confirmed_by"?: string | null,"created_at"?: string,"doc_type": string,"extraction"?: Json | null,"filename": string,"id"?: string,"storage_path"?: string | null
                  }
                  Update: {
                    "application_id"?: string,"confirmed_at"?: string | null,"confirmed_by"?: string | null,"created_at"?: string,"doc_type"?: string,"extraction"?: Json | null,"filename"?: string,"id"?: string,"storage_path"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "application_documents_application_id_fkey"
      columns: ["application_id"]
isOneToOne: false
      referencedRelation: "credit_applications"
      referencedColumns: ["id"]
    }
                  ]
                },"ar_aging_snapshots": {
                  Row: {
                    "bucket_1_30": number,"bucket_1_30_count": number | null,"bucket_31_60": number,"bucket_31_60_count": number | null,"bucket_61_90": number,"bucket_61_90_count": number | null,"bucket_over_90": number,"bucket_over_90_count": number | null,"created_at": string | null,"credit_limit": number | null,"current_amount": number,"current_count": number | null,"customer_id": string,"generated_by": string | null,"id": string,"pre_petition_amount": number,"snapshot_date": string,"total_invoice_count": number | null,"total_outstanding": number | null,"utilization_pct": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "bucket_1_30"?: number,"bucket_1_30_count"?: number | null,"bucket_31_60"?: number,"bucket_31_60_count"?: number | null,"bucket_61_90"?: number,"bucket_61_90_count"?: number | null,"bucket_over_90"?: number,"bucket_over_90_count"?: number | null,"created_at"?: string | null,"credit_limit"?: number | null,"current_amount"?: number,"current_count"?: number | null,"customer_id": string,"generated_by"?: string | null,"id"?: string,"pre_petition_amount"?: number,"snapshot_date"?: string,"total_invoice_count"?: never,"total_outstanding"?: never,"utilization_pct"?: number | null
                  }
                  Update: {
                    "bucket_1_30"?: number,"bucket_1_30_count"?: number | null,"bucket_31_60"?: number,"bucket_31_60_count"?: number | null,"bucket_61_90"?: number,"bucket_61_90_count"?: number | null,"bucket_over_90"?: number,"bucket_over_90_count"?: number | null,"created_at"?: string | null,"credit_limit"?: number | null,"current_amount"?: number,"current_count"?: number | null,"customer_id"?: string,"generated_by"?: string | null,"id"?: string,"pre_petition_amount"?: number,"snapshot_date"?: string,"total_invoice_count"?: never,"total_outstanding"?: never,"utilization_pct"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "ar_aging_snapshots_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ar_aging_snapshots_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_ar_aging_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "ar_aging_snapshots_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_customers_at_risk"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ar_aging_snapshots_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_growth_opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ar_aging_snapshots_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_payment_behaviour"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "ar_aging_snapshots_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_payment_behaviour_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "ar_aging_snapshots_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_sec_monitoring_dashboard"
      referencedColumns: ["customer_id"]
    }
                  ]
                },"bankruptcy_details": {
                  Row: {
                    "asset_buyer": string | null,"asset_sale_date": string | null,"case_number": string,"chapter": number,"chapter7_conversion_date": string | null,"court": string | null,"created_at": string | null,"customer_id": string,"emergence_date_estimated": string | null,"estimated_recovery_amount": number | null,"estimated_recovery_rate": number | null,"filing_date": string,"id": string,"legal_counsel": string | null,"notes": string | null,"plan_confirmation_date": string | null,"proof_of_claim_amount": number | null,"proof_of_claim_date": string | null,"proof_of_claim_filed": boolean | null,"reorganization_advisor": string | null,"status": Database["public"]['Enums']["bankruptcy_status"],"total_pre_petition_claim": number | null,"trustee": string | null,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "asset_buyer"?: string | null,"asset_sale_date"?: string | null,"case_number": string,"chapter": number,"chapter7_conversion_date"?: string | null,"court"?: string | null,"created_at"?: string | null,"customer_id": string,"emergence_date_estimated"?: string | null,"estimated_recovery_amount"?: number | null,"estimated_recovery_rate"?: number | null,"filing_date": string,"id"?: string,"legal_counsel"?: string | null,"notes"?: string | null,"plan_confirmation_date"?: string | null,"proof_of_claim_amount"?: number | null,"proof_of_claim_date"?: string | null,"proof_of_claim_filed"?: boolean | null,"reorganization_advisor"?: string | null,"status"?: Database["public"]['Enums']["bankruptcy_status"],"total_pre_petition_claim"?: number | null,"trustee"?: string | null,"updated_at"?: string | null
                  }
                  Update: {
                    "asset_buyer"?: string | null,"asset_sale_date"?: string | null,"case_number"?: string,"chapter"?: number,"chapter7_conversion_date"?: string | null,"court"?: string | null,"created_at"?: string | null,"customer_id"?: string,"emergence_date_estimated"?: string | null,"estimated_recovery_amount"?: number | null,"estimated_recovery_rate"?: number | null,"filing_date"?: string,"id"?: string,"legal_counsel"?: string | null,"notes"?: string | null,"plan_confirmation_date"?: string | null,"proof_of_claim_amount"?: number | null,"proof_of_claim_date"?: string | null,"proof_of_claim_filed"?: boolean | null,"reorganization_advisor"?: string | null,"status"?: Database["public"]['Enums']["bankruptcy_status"],"total_pre_petition_claim"?: number | null,"trustee"?: string | null,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "bankruptcy_details_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: true
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bankruptcy_details_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: true
      referencedRelation: "v_ar_aging_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "bankruptcy_details_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: true
      referencedRelation: "v_customers_at_risk"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bankruptcy_details_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: true
      referencedRelation: "v_growth_opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bankruptcy_details_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: true
      referencedRelation: "v_payment_behaviour"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "bankruptcy_details_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: true
      referencedRelation: "v_payment_behaviour_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "bankruptcy_details_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: true
      referencedRelation: "v_sec_monitoring_dashboard"
      referencedColumns: ["customer_id"]
    }
                  ]
                },"company": {
                  Row: {
                    "annual_revenue": number | null,"base_currency": string | null,"created_at": string | null,"description": string | null,"employees": number | null,"fiscal_year_end_month": number | null,"founded": number | null,"headquarters": string | null,"id": string,"industry": string | null,"max_single_customer_exposure_pct": number | null,"name": string,"review_trigger_days_overdue": number | null,"standard_payment_terms_days": number | null,"ticker": string | null,"total_portfolio_limit": number | null,"updated_at": string | null,"watch_list_trigger_days_overdue": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "annual_revenue"?: number | null,"base_currency"?: string | null,"created_at"?: string | null,"description"?: string | null,"employees"?: number | null,"fiscal_year_end_month"?: number | null,"founded"?: number | null,"headquarters"?: string | null,"id"?: string,"industry"?: string | null,"max_single_customer_exposure_pct"?: number | null,"name": string,"review_trigger_days_overdue"?: number | null,"standard_payment_terms_days"?: number | null,"ticker"?: string | null,"total_portfolio_limit"?: number | null,"updated_at"?: string | null,"watch_list_trigger_days_overdue"?: number | null
                  }
                  Update: {
                    "annual_revenue"?: number | null,"base_currency"?: string | null,"created_at"?: string | null,"description"?: string | null,"employees"?: number | null,"fiscal_year_end_month"?: number | null,"founded"?: number | null,"headquarters"?: string | null,"id"?: string,"industry"?: string | null,"max_single_customer_exposure_pct"?: number | null,"name"?: string,"review_trigger_days_overdue"?: number | null,"standard_payment_terms_days"?: number | null,"ticker"?: string | null,"total_portfolio_limit"?: number | null,"updated_at"?: string | null,"watch_list_trigger_days_overdue"?: number | null
                  }
                  Relationships: [
                    
                  ]
                },"company_settings": {
                  Row: {
                    "key": string,"updated_at": string,"updated_by": string | null,"value": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "key": string,"updated_at"?: string,"updated_by"?: string | null,"value": NonNullable<Json>
                  }
                  Update: {
                    "key"?: string,"updated_at"?: string,"updated_by"?: string | null,"value"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"company_settings_history": {
                  Row: {
                    "changed_at": string,"changed_by": string | null,"id": number,"key": string,"value": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "changed_at"?: string,"changed_by"?: string | null,"id"?: number,"key": string,"value": NonNullable<Json>
                  }
                  Update: {
                    "changed_at"?: string,"changed_by"?: string | null,"id"?: number,"key"?: string,"value"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"credit_actions": {
                  Row: {
                    "action_date": string,"action_type": Database["public"]['Enums']["credit_action_type"],"agent_name": string | null,"claim_amount": number | null,"created_at": string | null,"customer_id": string,"description": string | null,"id": string,"new_limit": number | null,"old_limit": number | null,"performed_by": string | null,"requires_review": boolean | null,"reviewed_at": string | null,"reviewed_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action_date": string,"action_type": Database["public"]['Enums']["credit_action_type"],"agent_name"?: string | null,"claim_amount"?: number | null,"created_at"?: string | null,"customer_id": string,"description"?: string | null,"id"?: string,"new_limit"?: number | null,"old_limit"?: number | null,"performed_by"?: string | null,"requires_review"?: boolean | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null
                  }
                  Update: {
                    "action_date"?: string,"action_type"?: Database["public"]['Enums']["credit_action_type"],"agent_name"?: string | null,"claim_amount"?: number | null,"created_at"?: string | null,"customer_id"?: string,"description"?: string | null,"id"?: string,"new_limit"?: number | null,"old_limit"?: number | null,"performed_by"?: string | null,"requires_review"?: boolean | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "credit_actions_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "credit_actions_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_ar_aging_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "credit_actions_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_customers_at_risk"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "credit_actions_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_growth_opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "credit_actions_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_payment_behaviour"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "credit_actions_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_payment_behaviour_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "credit_actions_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_sec_monitoring_dashboard"
      referencedColumns: ["customer_id"]
    }
                  ]
                },"credit_applications": {
                  Row: {
                    "answers": NonNullable<Json>,"clock_started_at": string | null,"completeness": Json | null,"created_at": string,"credit_assignee": string | null,"customer_id": string,"decision_due_at": string | null,"id": string,"invite_token_hash": string | null,"outcome": Json | null,"requested_limit_usd": number | null,"requested_terms_days": number | null,"sales_assignee": string | null,"stage": string,"status": string,"submitted_by": string | null,"submitted_via": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "answers"?: NonNullable<Json>,"clock_started_at"?: string | null,"completeness"?: Json | null,"created_at"?: string,"credit_assignee"?: string | null,"customer_id": string,"decision_due_at"?: string | null,"id"?: string,"invite_token_hash"?: string | null,"outcome"?: Json | null,"requested_limit_usd"?: number | null,"requested_terms_days"?: number | null,"sales_assignee"?: string | null,"stage"?: string,"status"?: string,"submitted_by"?: string | null,"submitted_via"?: string,"updated_at"?: string
                  }
                  Update: {
                    "answers"?: NonNullable<Json>,"clock_started_at"?: string | null,"completeness"?: Json | null,"created_at"?: string,"credit_assignee"?: string | null,"customer_id"?: string,"decision_due_at"?: string | null,"id"?: string,"invite_token_hash"?: string | null,"outcome"?: Json | null,"requested_limit_usd"?: number | null,"requested_terms_days"?: number | null,"sales_assignee"?: string | null,"stage"?: string,"status"?: string,"submitted_by"?: string | null,"submitted_via"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "credit_applications_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "credit_applications_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_ar_aging_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "credit_applications_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_customers_at_risk"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "credit_applications_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_growth_opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "credit_applications_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_payment_behaviour"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "credit_applications_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_payment_behaviour_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "credit_applications_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_sec_monitoring_dashboard"
      referencedColumns: ["customer_id"]
    }
                  ]
                },"credit_events": {
                  Row: {
                    "action_required": boolean | null,"action_status": string | null,"action_type": string | null,"archived_at": string | null,"cia_decision": string | null,"cia_processed": boolean | null,"cia_processed_at": string | null,"correlation_id": string | null,"created_at": string | null,"credit_rating_raw": string | null,"credit_rating_score": number | null,"credit_rating_source": string | null,"customer_id": string | null,"customer_ids": (string)[] | null,"description": string | null,"event_type": string,"id": string,"is_demo": boolean,"negative_news_id": string | null,"new_value": number | null,"parent_event_id": string | null,"payload": NonNullable<Json>,"previous_value": number | null,"review_note": string | null,"reviewed_at": string | null,"reviewed_by": string | null,"run_id": string | null,"scope": string,"severity": string,"severity_score": number | null,"signal_type": string | null,"source_agent": string,"summary": string | null,"title": string,"updated_at": string | null,"value_type": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action_required"?: boolean | null,"action_status"?: string | null,"action_type"?: string | null,"archived_at"?: string | null,"cia_decision"?: string | null,"cia_processed"?: boolean | null,"cia_processed_at"?: string | null,"correlation_id"?: string | null,"created_at"?: string | null,"credit_rating_raw"?: string | null,"credit_rating_score"?: number | null,"credit_rating_source"?: string | null,"customer_id"?: string | null,"customer_ids"?: (string)[] | null,"description"?: string | null,"event_type": string,"id"?: string,"is_demo"?: boolean,"negative_news_id"?: string | null,"new_value"?: number | null,"parent_event_id"?: string | null,"payload"?: NonNullable<Json>,"previous_value"?: number | null,"review_note"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"run_id"?: string | null,"scope"?: string,"severity": string,"severity_score"?: number | null,"signal_type"?: string | null,"source_agent": string,"summary"?: string | null,"title": string,"updated_at"?: string | null,"value_type"?: string | null
                  }
                  Update: {
                    "action_required"?: boolean | null,"action_status"?: string | null,"action_type"?: string | null,"archived_at"?: string | null,"cia_decision"?: string | null,"cia_processed"?: boolean | null,"cia_processed_at"?: string | null,"correlation_id"?: string | null,"created_at"?: string | null,"credit_rating_raw"?: string | null,"credit_rating_score"?: number | null,"credit_rating_source"?: string | null,"customer_id"?: string | null,"customer_ids"?: (string)[] | null,"description"?: string | null,"event_type"?: string,"id"?: string,"is_demo"?: boolean,"negative_news_id"?: string | null,"new_value"?: number | null,"parent_event_id"?: string | null,"payload"?: NonNullable<Json>,"previous_value"?: number | null,"review_note"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"run_id"?: string | null,"scope"?: string,"severity"?: string,"severity_score"?: number | null,"signal_type"?: string | null,"source_agent"?: string,"summary"?: string | null,"title"?: string,"updated_at"?: string | null,"value_type"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "credit_events_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "credit_events_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_ar_aging_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "credit_events_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_customers_at_risk"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "credit_events_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_growth_opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "credit_events_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_payment_behaviour"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "credit_events_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_payment_behaviour_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "credit_events_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_sec_monitoring_dashboard"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "credit_events_negative_news_id_fkey"
      columns: ["negative_news_id"]
isOneToOne: false
      referencedRelation: "negative_news"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "credit_events_parent_fk"
      columns: ["parent_event_id"]
isOneToOne: false
      referencedRelation: "credit_events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "credit_events_run_id_fkey"
      columns: ["run_id"]
isOneToOne: false
      referencedRelation: "agent_runs"
      referencedColumns: ["id"]
    }
                  ]
                },"credit_metric_changes": {
                  Row: {
                    "agent_name": string | null,"change_date": string,"created_at": string | null,"customer_id": string,"id": string,"metric_name": string,"new_value": number | null,"old_value": number | null,"source": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "agent_name"?: string | null,"change_date": string,"created_at"?: string | null,"customer_id": string,"id"?: string,"metric_name": string,"new_value"?: number | null,"old_value"?: number | null,"source"?: string | null
                  }
                  Update: {
                    "agent_name"?: string | null,"change_date"?: string,"created_at"?: string | null,"customer_id"?: string,"id"?: string,"metric_name"?: string,"new_value"?: number | null,"old_value"?: number | null,"source"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "credit_metric_changes_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "credit_metric_changes_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_ar_aging_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "credit_metric_changes_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_customers_at_risk"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "credit_metric_changes_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_growth_opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "credit_metric_changes_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_payment_behaviour"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "credit_metric_changes_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_payment_behaviour_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "credit_metric_changes_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_sec_monitoring_dashboard"
      referencedColumns: ["customer_id"]
    }
                  ]
                },"credit_metrics": {
                  Row: {
                    "altman_z_score": number | null,"burn_rate_quarterly": number | null,"cash_on_hand": number | null,"created_at": string | null,"credit_score": number | null,"current_ratio": number | null,"customer_id": string,"d_and_b_failure_score": number | null,"d_and_b_rating": string | null,"debt_to_equity": number | null,"financials_source": string | null,"id": string,"interest_coverage": number | null,"last_financials_date": string | null,"parent_company_guarantee": boolean | null,"private_company": boolean | null,"quick_ratio": number | null,"total_debt": number | null,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "altman_z_score"?: number | null,"burn_rate_quarterly"?: number | null,"cash_on_hand"?: number | null,"created_at"?: string | null,"credit_score"?: number | null,"current_ratio"?: number | null,"customer_id": string,"d_and_b_failure_score"?: number | null,"d_and_b_rating"?: string | null,"debt_to_equity"?: number | null,"financials_source"?: string | null,"id"?: string,"interest_coverage"?: number | null,"last_financials_date"?: string | null,"parent_company_guarantee"?: boolean | null,"private_company"?: boolean | null,"quick_ratio"?: number | null,"total_debt"?: number | null,"updated_at"?: string | null
                  }
                  Update: {
                    "altman_z_score"?: number | null,"burn_rate_quarterly"?: number | null,"cash_on_hand"?: number | null,"created_at"?: string | null,"credit_score"?: number | null,"current_ratio"?: number | null,"customer_id"?: string,"d_and_b_failure_score"?: number | null,"d_and_b_rating"?: string | null,"debt_to_equity"?: number | null,"financials_source"?: string | null,"id"?: string,"interest_coverage"?: number | null,"last_financials_date"?: string | null,"parent_company_guarantee"?: boolean | null,"private_company"?: boolean | null,"quick_ratio"?: number | null,"total_debt"?: number | null,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "credit_metrics_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: true
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "credit_metrics_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: true
      referencedRelation: "v_ar_aging_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "credit_metrics_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: true
      referencedRelation: "v_customers_at_risk"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "credit_metrics_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: true
      referencedRelation: "v_growth_opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "credit_metrics_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: true
      referencedRelation: "v_payment_behaviour"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "credit_metrics_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: true
      referencedRelation: "v_payment_behaviour_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "credit_metrics_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: true
      referencedRelation: "v_sec_monitoring_dashboard"
      referencedColumns: ["customer_id"]
    }
                  ]
                },"customer_identifiers": {
                  Row: {
                    "created_at": string,"customer_id": string,"id": string,"id_type": string,"id_value": string,"is_primary": boolean,"source": string,"updated_at": string,"verified_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"customer_id": string,"id"?: string,"id_type": string,"id_value": string,"is_primary"?: boolean,"source": string,"updated_at"?: string,"verified_at"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"customer_id"?: string,"id"?: string,"id_type"?: string,"id_value"?: string,"is_primary"?: boolean,"source"?: string,"updated_at"?: string,"verified_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "customer_identifiers_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "customer_identifiers_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_ar_aging_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "customer_identifiers_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_customers_at_risk"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "customer_identifiers_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_growth_opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "customer_identifiers_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_payment_behaviour"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "customer_identifiers_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_payment_behaviour_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "customer_identifiers_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_sec_monitoring_dashboard"
      referencedColumns: ["customer_id"]
    }
                  ]
                },"customers": {
                  Row: {
                    "account_manager": string | null,"city": string | null,"company_name": string,"company_type": string | null,"contract_expiry": string | null,"country_code": string,"created_at": string | null,"credit_limit": number,"credit_manager": string | null,"credit_rating_previous_score": number | null,"credit_rating_raw": string | null,"credit_rating_score": number | null,"credit_rating_source": string | null,"credit_rating_updated_at": string | null,"current_exposure": number,"customer_since": string | null,"headquarters": string | null,"id": string,"industry": string | null,"international_business_name": string | null,"invoicing_currency": string | null,"last_reviewed": string | null,"lifecycle_status": string,"market_cap_tier": Database["public"]['Enums']["market_cap_tier"] | null,"market_cap_usd": number | null,"naics_sic_code": string | null,"notes": string | null,"payment_avg_days_early_late": number | null,"payment_behaviour_updated_at": string | null,"payment_health": string | null,"payment_on_time_rate": number | null,"payment_terms_days": number,"payment_trend": string | null,"postcode": string | null,"preferred_customer": boolean | null,"primary_contact": string | null,"primary_products": (string)[] | null,"risk_tags": (string)[] | null,"risk_tags_updated_at": string | null,"scenario": Database["public"]['Enums']["scenario_type"],"sector": string,"street_address": string | null,"trade_name": string | null,"updated_at": string | null,"website": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_manager"?: string | null,"city"?: string | null,"company_name": string,"company_type"?: string | null,"contract_expiry"?: string | null,"country_code"?: string,"created_at"?: string | null,"credit_limit"?: number,"credit_manager"?: string | null,"credit_rating_previous_score"?: number | null,"credit_rating_raw"?: string | null,"credit_rating_score"?: number | null,"credit_rating_source"?: string | null,"credit_rating_updated_at"?: string | null,"current_exposure"?: number,"customer_since"?: string | null,"headquarters"?: string | null,"id"?: string,"industry"?: string | null,"international_business_name"?: string | null,"invoicing_currency"?: string | null,"last_reviewed"?: string | null,"lifecycle_status"?: string,"market_cap_tier"?: Database["public"]['Enums']["market_cap_tier"] | null,"market_cap_usd"?: number | null,"naics_sic_code"?: string | null,"notes"?: string | null,"payment_avg_days_early_late"?: number | null,"payment_behaviour_updated_at"?: string | null,"payment_health"?: string | null,"payment_on_time_rate"?: number | null,"payment_terms_days"?: number,"payment_trend"?: string | null,"postcode"?: string | null,"preferred_customer"?: boolean | null,"primary_contact"?: string | null,"primary_products"?: (string)[] | null,"risk_tags"?: (string)[] | null,"risk_tags_updated_at"?: string | null,"scenario"?: Database["public"]['Enums']["scenario_type"],"sector": string,"street_address"?: string | null,"trade_name"?: string | null,"updated_at"?: string | null,"website"?: string | null
                  }
                  Update: {
                    "account_manager"?: string | null,"city"?: string | null,"company_name"?: string,"company_type"?: string | null,"contract_expiry"?: string | null,"country_code"?: string,"created_at"?: string | null,"credit_limit"?: number,"credit_manager"?: string | null,"credit_rating_previous_score"?: number | null,"credit_rating_raw"?: string | null,"credit_rating_score"?: number | null,"credit_rating_source"?: string | null,"credit_rating_updated_at"?: string | null,"current_exposure"?: number,"customer_since"?: string | null,"headquarters"?: string | null,"id"?: string,"industry"?: string | null,"international_business_name"?: string | null,"invoicing_currency"?: string | null,"last_reviewed"?: string | null,"lifecycle_status"?: string,"market_cap_tier"?: Database["public"]['Enums']["market_cap_tier"] | null,"market_cap_usd"?: number | null,"naics_sic_code"?: string | null,"notes"?: string | null,"payment_avg_days_early_late"?: number | null,"payment_behaviour_updated_at"?: string | null,"payment_health"?: string | null,"payment_on_time_rate"?: number | null,"payment_terms_days"?: number,"payment_trend"?: string | null,"postcode"?: string | null,"preferred_customer"?: boolean | null,"primary_contact"?: string | null,"primary_products"?: (string)[] | null,"risk_tags"?: (string)[] | null,"risk_tags_updated_at"?: string | null,"scenario"?: Database["public"]['Enums']["scenario_type"],"sector"?: string,"street_address"?: string | null,"trade_name"?: string | null,"updated_at"?: string | null,"website"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"fx_currency_status": {
                  Row: {
                    "as_of": string,"change_30d_pct": number | null,"change_5d_pct": number | null,"currency": string,"rate": number,"rate_date": string,"source": string,"volatility_pct": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "as_of"?: string,"change_30d_pct"?: number | null,"change_5d_pct"?: number | null,"currency": string,"rate": number,"rate_date": string,"source"?: string,"volatility_pct"?: number | null
                  }
                  Update: {
                    "as_of"?: string,"change_30d_pct"?: number | null,"change_5d_pct"?: number | null,"currency"?: string,"rate"?: number,"rate_date"?: string,"source"?: string,"volatility_pct"?: number | null
                  }
                  Relationships: [
                    
                  ]
                },"fx_rate_history": {
                  Row: {
                    "created_at": string,"currency": string,"rate": number,"rate_date": string,"source": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"currency": string,"rate": number,"rate_date": string,"source"?: string
                  }
                  Update: {
                    "created_at"?: string,"currency"?: string,"rate"?: number,"rate_date"?: string,"source"?: string
                  }
                  Relationships: [
                    
                  ]
                },"growth_signals": {
                  Row: {
                    "agent_name": string | null,"backlog_amount": number | null,"backlog_description": string | null,"created_at": string | null,"credit_limit_increase_recommended": boolean | null,"customer_id": string,"growth_trajectory": string | null,"id": string,"rationale": string | null,"recent_milestones": (string)[] | null,"recommended_new_limit": number | null,"revenue_growth_yoy": number | null,"updated_at": string | null,"upsell_opportunity": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "agent_name"?: string | null,"backlog_amount"?: number | null,"backlog_description"?: string | null,"created_at"?: string | null,"credit_limit_increase_recommended"?: boolean | null,"customer_id": string,"growth_trajectory"?: string | null,"id"?: string,"rationale"?: string | null,"recent_milestones"?: (string)[] | null,"recommended_new_limit"?: number | null,"revenue_growth_yoy"?: number | null,"updated_at"?: string | null,"upsell_opportunity"?: string | null
                  }
                  Update: {
                    "agent_name"?: string | null,"backlog_amount"?: number | null,"backlog_description"?: string | null,"created_at"?: string | null,"credit_limit_increase_recommended"?: boolean | null,"customer_id"?: string,"growth_trajectory"?: string | null,"id"?: string,"rationale"?: string | null,"recent_milestones"?: (string)[] | null,"recommended_new_limit"?: number | null,"revenue_growth_yoy"?: number | null,"updated_at"?: string | null,"upsell_opportunity"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "growth_signals_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: true
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "growth_signals_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: true
      referencedRelation: "v_ar_aging_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "growth_signals_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: true
      referencedRelation: "v_customers_at_risk"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "growth_signals_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: true
      referencedRelation: "v_growth_opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "growth_signals_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: true
      referencedRelation: "v_payment_behaviour"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "growth_signals_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: true
      referencedRelation: "v_payment_behaviour_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "growth_signals_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: true
      referencedRelation: "v_sec_monitoring_dashboard"
      referencedColumns: ["customer_id"]
    }
                  ]
                },"invoices": {
                  Row: {
                    "amount_outstanding": number | null,"amount_paid": number,"booking_fx_rate": number | null,"claimable": boolean | null,"created_at": string | null,"currency": string | null,"currency_amount": number | null,"customer_id": string,"days_overdue": number,"demo_days_offset": number | null,"due_date": string,"dunning_sent_date": string | null,"dunning_stage": Database["public"]['Enums']["dunning_stage"] | null,"escalated_to_collections": boolean | null,"fx_hedged": boolean,"id": string,"invoice_amount": number,"invoice_date": string | null,"invoice_number": string,"is_demo": boolean,"outstanding_amount": number,"product_description": string | null,"purchase_order_number": string | null,"status": Database["public"]['Enums']["invoice_status"],"updated_at": string | null,"upload_source": string | null,"uploaded_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_outstanding"?: never,"amount_paid"?: number,"booking_fx_rate"?: number | null,"claimable"?: boolean | null,"created_at"?: string | null,"currency"?: string | null,"currency_amount"?: number | null,"customer_id": string,"days_overdue"?: number,"demo_days_offset"?: number | null,"due_date": string,"dunning_sent_date"?: string | null,"dunning_stage"?: Database["public"]['Enums']["dunning_stage"] | null,"escalated_to_collections"?: boolean | null,"fx_hedged"?: boolean,"id"?: string,"invoice_amount": number,"invoice_date"?: string | null,"invoice_number": string,"is_demo"?: boolean,"outstanding_amount"?: number,"product_description"?: string | null,"purchase_order_number"?: string | null,"status"?: Database["public"]['Enums']["invoice_status"],"updated_at"?: string | null,"upload_source"?: string | null,"uploaded_at"?: string | null
                  }
                  Update: {
                    "amount_outstanding"?: never,"amount_paid"?: number,"booking_fx_rate"?: number | null,"claimable"?: boolean | null,"created_at"?: string | null,"currency"?: string | null,"currency_amount"?: number | null,"customer_id"?: string,"days_overdue"?: number,"demo_days_offset"?: number | null,"due_date"?: string,"dunning_sent_date"?: string | null,"dunning_stage"?: Database["public"]['Enums']["dunning_stage"] | null,"escalated_to_collections"?: boolean | null,"fx_hedged"?: boolean,"id"?: string,"invoice_amount"?: number,"invoice_date"?: string | null,"invoice_number"?: string,"is_demo"?: boolean,"outstanding_amount"?: number,"product_description"?: string | null,"purchase_order_number"?: string | null,"status"?: Database["public"]['Enums']["invoice_status"],"updated_at"?: string | null,"upload_source"?: string | null,"uploaded_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoices_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoices_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_ar_aging_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "invoices_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_customers_at_risk"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoices_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_growth_opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoices_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_payment_behaviour"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "invoices_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_payment_behaviour_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "invoices_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_sec_monitoring_dashboard"
      referencedColumns: ["customer_id"]
    }
                  ]
                },"ip_question_counts": {
                  Row: {
                    "ip_address": string,"question_count": number,"question_date": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ip_address": string,"question_count"?: number,"question_date": string,"updated_at"?: string
                  }
                  Update: {
                    "ip_address"?: string,"question_count"?: number,"question_date"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"ip_reset_counts": {
                  Row: {
                    "ip_address": string,"reset_count": number,"reset_date": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ip_address": string,"reset_count"?: number,"reset_date": string,"updated_at"?: string
                  }
                  Update: {
                    "ip_address"?: string,"reset_count"?: number,"reset_date"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"negative_news": {
                  Row: {
                    "action_taken": string | null,"agent_name": string | null,"category": string | null,"classification_source": string | null,"confidence": number | null,"content_fingerprint": string | null,"created_at": string | null,"customer_id": string,"headline": string,"id": string,"is_demo": boolean,"news_date": string,"provider": string | null,"relevance_score": number | null,"reviewed": boolean | null,"reviewed_at": string | null,"reviewed_by": string | null,"sentiment_score": number | null,"severity": string | null,"source": string | null,"summary": string | null,"url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action_taken"?: string | null,"agent_name"?: string | null,"category"?: string | null,"classification_source"?: string | null,"confidence"?: number | null,"content_fingerprint"?: string | null,"created_at"?: string | null,"customer_id": string,"headline": string,"id"?: string,"is_demo"?: boolean,"news_date": string,"provider"?: string | null,"relevance_score"?: number | null,"reviewed"?: boolean | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"sentiment_score"?: number | null,"severity"?: string | null,"source"?: string | null,"summary"?: string | null,"url"?: string | null
                  }
                  Update: {
                    "action_taken"?: string | null,"agent_name"?: string | null,"category"?: string | null,"classification_source"?: string | null,"confidence"?: number | null,"content_fingerprint"?: string | null,"created_at"?: string | null,"customer_id"?: string,"headline"?: string,"id"?: string,"is_demo"?: boolean,"news_date"?: string,"provider"?: string | null,"relevance_score"?: number | null,"reviewed"?: boolean | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"sentiment_score"?: number | null,"severity"?: string | null,"source"?: string | null,"summary"?: string | null,"url"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "negative_news_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "negative_news_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_ar_aging_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "negative_news_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_customers_at_risk"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "negative_news_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_growth_opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "negative_news_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_payment_behaviour"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "negative_news_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_payment_behaviour_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "negative_news_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_sec_monitoring_dashboard"
      referencedColumns: ["customer_id"]
    }
                  ]
                },"payment_transactions": {
                  Row: {
                    "amount_paid": number,"created_at": string | null,"customer_id": string,"days_early_late": number | null,"days_to_pay": number | null,"demo_days_offset": number | null,"id": string,"invoice_date": string | null,"invoice_due_date": string | null,"invoice_id": string | null,"invoice_number": string | null,"is_demo": boolean,"is_partial_payment": boolean | null,"notes": string | null,"on_time": boolean | null,"payment_date": string,"payment_method": Database["public"]['Enums']["payment_method"] | null,"posted_by": string | null,"reference_number": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_paid": number,"created_at"?: string | null,"customer_id": string,"days_early_late"?: number | null,"days_to_pay"?: number | null,"demo_days_offset"?: number | null,"id"?: string,"invoice_date"?: string | null,"invoice_due_date"?: string | null,"invoice_id"?: string | null,"invoice_number"?: string | null,"is_demo"?: boolean,"is_partial_payment"?: boolean | null,"notes"?: string | null,"on_time"?: boolean | null,"payment_date": string,"payment_method"?: Database["public"]['Enums']["payment_method"] | null,"posted_by"?: string | null,"reference_number"?: string | null
                  }
                  Update: {
                    "amount_paid"?: number,"created_at"?: string | null,"customer_id"?: string,"days_early_late"?: number | null,"days_to_pay"?: number | null,"demo_days_offset"?: number | null,"id"?: string,"invoice_date"?: string | null,"invoice_due_date"?: string | null,"invoice_id"?: string | null,"invoice_number"?: string | null,"is_demo"?: boolean,"is_partial_payment"?: boolean | null,"notes"?: string | null,"on_time"?: boolean | null,"payment_date"?: string,"payment_method"?: Database["public"]['Enums']["payment_method"] | null,"posted_by"?: string | null,"reference_number"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_transactions_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_transactions_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_ar_aging_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "payment_transactions_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_customers_at_risk"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_transactions_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_growth_opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_transactions_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_payment_behaviour"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "payment_transactions_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_payment_behaviour_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "payment_transactions_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_sec_monitoring_dashboard"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "payment_transactions_invoice_id_fkey"
      columns: ["invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_transactions_invoice_id_fkey"
      columns: ["invoice_id"]
isOneToOne: false
      referencedRelation: "v_fx_exposure_by_invoice"
      referencedColumns: ["invoice_id"]
    }
                  ]
                },"pending_actions": {
                  Row: {
                    "action_type": string,"agent_name": string,"application_id": string | null,"binding_method": string | null,"conditions": Json | null,"created_at": string,"current_value": number | null,"customer_id": string,"decided_value": number | null,"expires_at": string | null,"id": string,"is_demo": boolean,"memo": Json | null,"message_id": string | null,"proposed_value": number | null,"rationale": string,"reason_codes": (string)[] | null,"recommended_value": number | null,"reduction_pct": number | null,"requested_value": number | null,"review_note": string | null,"reviewed_at": string | null,"reviewed_by": string | null,"reviewed_by_user": string | null,"run_id": string,"severity": string | null,"source_event_ids": (string)[] | null,"status": string,"supportable_value": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action_type": string,"agent_name": string,"application_id"?: string | null,"binding_method"?: string | null,"conditions"?: Json | null,"created_at"?: string,"current_value"?: number | null,"customer_id": string,"decided_value"?: number | null,"expires_at"?: string | null,"id"?: string,"is_demo"?: boolean,"memo"?: Json | null,"message_id"?: string | null,"proposed_value"?: number | null,"rationale": string,"reason_codes"?: (string)[] | null,"recommended_value"?: number | null,"reduction_pct"?: number | null,"requested_value"?: number | null,"review_note"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"reviewed_by_user"?: string | null,"run_id": string,"severity"?: string | null,"source_event_ids"?: (string)[] | null,"status"?: string,"supportable_value"?: number | null
                  }
                  Update: {
                    "action_type"?: string,"agent_name"?: string,"application_id"?: string | null,"binding_method"?: string | null,"conditions"?: Json | null,"created_at"?: string,"current_value"?: number | null,"customer_id"?: string,"decided_value"?: number | null,"expires_at"?: string | null,"id"?: string,"is_demo"?: boolean,"memo"?: Json | null,"message_id"?: string | null,"proposed_value"?: number | null,"rationale"?: string,"reason_codes"?: (string)[] | null,"recommended_value"?: number | null,"reduction_pct"?: number | null,"requested_value"?: number | null,"review_note"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"reviewed_by_user"?: string | null,"run_id"?: string,"severity"?: string | null,"source_event_ids"?: (string)[] | null,"status"?: string,"supportable_value"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "pending_actions_application_id_fkey"
      columns: ["application_id"]
isOneToOne: false
      referencedRelation: "credit_applications"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pending_actions_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pending_actions_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_ar_aging_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "pending_actions_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_customers_at_risk"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pending_actions_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_growth_opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pending_actions_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_payment_behaviour"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "pending_actions_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_payment_behaviour_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "pending_actions_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_sec_monitoring_dashboard"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "pending_actions_message_id_fkey"
      columns: ["message_id"]
isOneToOne: false
      referencedRelation: "agent_messages"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pending_actions_run_id_fkey"
      columns: ["run_id"]
isOneToOne: false
      referencedRelation: "agent_runs"
      referencedColumns: ["id"]
    }
                  ]
                },"sanctions_entries": {
                  Row: {
                    "aliases": (string)[],"country_code": string | null,"date_of_birth": string | null,"entry_type": string,"id": number,"list": string,"list_id": string,"name": string,"programs": (string)[],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "aliases"?: (string)[],"country_code"?: string | null,"date_of_birth"?: string | null,"entry_type": string,"id"?: number,"list": string,"list_id": string,"name": string,"programs"?: (string)[],"updated_at"?: string
                  }
                  Update: {
                    "aliases"?: (string)[],"country_code"?: string | null,"date_of_birth"?: string | null,"entry_type"?: string,"id"?: number,"list"?: string,"list_id"?: string,"name"?: string,"programs"?: (string)[],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"sanctions_entries_staging": {
                  Row: {
                    "aliases": (string)[],"country_code": string | null,"date_of_birth": string | null,"entry_type": string,"list": string,"list_id": string,"name": string,"names_norm": (string)[],"programs": (string)[],"run_id": number
                  }
                  ComputedFields: never
                  Insert: {
                    "aliases"?: (string)[],"country_code"?: string | null,"date_of_birth"?: string | null,"entry_type": string,"list": string,"list_id": string,"name": string,"names_norm"?: (string)[],"programs"?: (string)[],"run_id": number
                  }
                  Update: {
                    "aliases"?: (string)[],"country_code"?: string | null,"date_of_birth"?: string | null,"entry_type"?: string,"list"?: string,"list_id"?: string,"name"?: string,"names_norm"?: (string)[],"programs"?: (string)[],"run_id"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "sanctions_entries_staging_run_id_fkey"
      columns: ["run_id"]
isOneToOne: false
      referencedRelation: "sanctions_list_runs"
      referencedColumns: ["id"]
    }
                  ]
                },"sanctions_list_runs": {
                  Row: {
                    "entry_count": number | null,"error": string | null,"finished_at": string | null,"id": number,"list": string,"source_url": string,"started_at": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "entry_count"?: number | null,"error"?: string | null,"finished_at"?: string | null,"id"?: number,"list": string,"source_url": string,"started_at"?: string,"status"?: string
                  }
                  Update: {
                    "entry_count"?: number | null,"error"?: string | null,"finished_at"?: string | null,"id"?: number,"list"?: string,"source_url"?: string,"started_at"?: string,"status"?: string
                  }
                  Relationships: [
                    
                  ]
                },"sanctions_names": {
                  Row: {
                    "entry_id": number,"name_norm": string
                  }
                  ComputedFields: never
                  Insert: {
                    "entry_id": number,"name_norm": string
                  }
                  Update: {
                    "entry_id"?: number,"name_norm"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sanctions_names_entry_id_fkey"
      columns: ["entry_id"]
isOneToOne: false
      referencedRelation: "sanctions_entries"
      referencedColumns: ["id"]
    }
                  ]
                },"score_results": {
                  Row: {
                    "application_id": string,"as_of": string | null,"band": string | null,"created_at": string,"detail": Json | null,"id": string,"inputs": Json | null,"max_credit_recommendation_usd": number | null,"provider": string,"score": number | null,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "application_id": string,"as_of"?: string | null,"band"?: string | null,"created_at"?: string,"detail"?: Json | null,"id"?: string,"inputs"?: Json | null,"max_credit_recommendation_usd"?: number | null,"provider": string,"score"?: number | null,"status"?: string
                  }
                  Update: {
                    "application_id"?: string,"as_of"?: string | null,"band"?: string | null,"created_at"?: string,"detail"?: Json | null,"id"?: string,"inputs"?: Json | null,"max_credit_recommendation_usd"?: number | null,"provider"?: string,"score"?: number | null,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "score_results_application_id_fkey"
      columns: ["application_id"]
isOneToOne: false
      referencedRelation: "credit_applications"
      referencedColumns: ["id"]
    }
                  ]
                },"screening_checks": {
                  Row: {
                    "check_type": string,"created_at": string,"detail": Json | null,"id": string,"result": string,"run_id": string,"source": string | null,"subject": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "check_type": string,"created_at"?: string,"detail"?: Json | null,"id"?: string,"result": string,"run_id": string,"source"?: string | null,"subject"?: string | null
                  }
                  Update: {
                    "check_type"?: string,"created_at"?: string,"detail"?: Json | null,"id"?: string,"result"?: string,"run_id"?: string,"source"?: string | null,"subject"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "screening_checks_run_id_fkey"
      columns: ["run_id"]
isOneToOne: false
      referencedRelation: "screening_runs"
      referencedColumns: ["id"]
    }
                  ]
                },"screening_hits": {
                  Row: {
                    "country": string | null,"created_at": string,"detail": Json | null,"disposed_at": string | null,"disposition": string,"disposition_by": string | null,"disposition_note": string | null,"id": string,"list_name": string,"matched_name": string,"run_id": string,"similarity": number,"subject_name": string,"subject_role": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "country"?: string | null,"created_at"?: string,"detail"?: Json | null,"disposed_at"?: string | null,"disposition"?: string,"disposition_by"?: string | null,"disposition_note"?: string | null,"id"?: string,"list_name": string,"matched_name": string,"run_id": string,"similarity": number,"subject_name": string,"subject_role"?: string | null
                  }
                  Update: {
                    "country"?: string | null,"created_at"?: string,"detail"?: Json | null,"disposed_at"?: string | null,"disposition"?: string,"disposition_by"?: string | null,"disposition_note"?: string | null,"id"?: string,"list_name"?: string,"matched_name"?: string,"run_id"?: string,"similarity"?: number,"subject_name"?: string,"subject_role"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "screening_hits_run_id_fkey"
      columns: ["run_id"]
isOneToOne: false
      referencedRelation: "screening_runs"
      referencedColumns: ["id"]
    }
                  ]
                },"screening_runs": {
                  Row: {
                    "application_id": string,"completed_at": string | null,"id": string,"lists_version": Json | null,"result": string,"run_by": string | null,"started_at": string,"summary": Json | null
                  }
                  ComputedFields: never
                  Insert: {
                    "application_id": string,"completed_at"?: string | null,"id"?: string,"lists_version"?: Json | null,"result"?: string,"run_by"?: string | null,"started_at"?: string,"summary"?: Json | null
                  }
                  Update: {
                    "application_id"?: string,"completed_at"?: string | null,"id"?: string,"lists_version"?: Json | null,"result"?: string,"run_by"?: string | null,"started_at"?: string,"summary"?: Json | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "screening_runs_application_id_fkey"
      columns: ["application_id"]
isOneToOne: false
      referencedRelation: "credit_applications"
      referencedColumns: ["id"]
    }
                  ]
                },"sec_filings": {
                  Row: {
                    "accession_number": string | null,"agent_name": string | null,"cik": string | null,"created_at": string | null,"customer_id": string,"document_url": string | null,"filing_date": string,"filing_type": string,"id": string,"is_demo": boolean,"key_findings": string | null,"provider": string | null,"reviewed": boolean | null,"reviewed_at": string | null,"reviewed_by": string | null,"risk_signals": (string)[] | null,"url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "accession_number"?: string | null,"agent_name"?: string | null,"cik"?: string | null,"created_at"?: string | null,"customer_id": string,"document_url"?: string | null,"filing_date": string,"filing_type": string,"id"?: string,"is_demo"?: boolean,"key_findings"?: string | null,"provider"?: string | null,"reviewed"?: boolean | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"risk_signals"?: (string)[] | null,"url"?: string | null
                  }
                  Update: {
                    "accession_number"?: string | null,"agent_name"?: string | null,"cik"?: string | null,"created_at"?: string | null,"customer_id"?: string,"document_url"?: string | null,"filing_date"?: string,"filing_type"?: string,"id"?: string,"is_demo"?: boolean,"key_findings"?: string | null,"provider"?: string | null,"reviewed"?: boolean | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"risk_signals"?: (string)[] | null,"url"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "sec_filings_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sec_filings_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_ar_aging_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "sec_filings_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_customers_at_risk"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sec_filings_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_growth_opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sec_filings_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_payment_behaviour"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "sec_filings_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_payment_behaviour_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "sec_filings_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_sec_monitoring_dashboard"
      referencedColumns: ["customer_id"]
    }
                  ]
                },"sec_monitoring": {
                  Row: {
                    "alert_action_taken": string | null,"alert_date": string | null,"alert_triggered": boolean | null,"cik": string,"created_at": string | null,"customer_id": string,"filing_types_monitored": (string)[] | null,"id": string,"is_demo": boolean,"last_10k_date": string | null,"last_10q_date": string | null,"last_8k_date": string | null,"last_checked_at": string | null,"monitoring_active": boolean | null,"next_scheduled_review": string | null,"risk_signals_detected": (string)[] | null,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "alert_action_taken"?: string | null,"alert_date"?: string | null,"alert_triggered"?: boolean | null,"cik": string,"created_at"?: string | null,"customer_id": string,"filing_types_monitored"?: (string)[] | null,"id"?: string,"is_demo"?: boolean,"last_10k_date"?: string | null,"last_10q_date"?: string | null,"last_8k_date"?: string | null,"last_checked_at"?: string | null,"monitoring_active"?: boolean | null,"next_scheduled_review"?: string | null,"risk_signals_detected"?: (string)[] | null,"updated_at"?: string | null
                  }
                  Update: {
                    "alert_action_taken"?: string | null,"alert_date"?: string | null,"alert_triggered"?: boolean | null,"cik"?: string,"created_at"?: string | null,"customer_id"?: string,"filing_types_monitored"?: (string)[] | null,"id"?: string,"is_demo"?: boolean,"last_10k_date"?: string | null,"last_10q_date"?: string | null,"last_8k_date"?: string | null,"last_checked_at"?: string | null,"monitoring_active"?: boolean | null,"next_scheduled_review"?: string | null,"risk_signals_detected"?: (string)[] | null,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "sec_monitoring_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: true
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sec_monitoring_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: true
      referencedRelation: "v_ar_aging_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "sec_monitoring_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: true
      referencedRelation: "v_customers_at_risk"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sec_monitoring_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: true
      referencedRelation: "v_growth_opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sec_monitoring_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: true
      referencedRelation: "v_payment_behaviour"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "sec_monitoring_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: true
      referencedRelation: "v_payment_behaviour_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "sec_monitoring_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: true
      referencedRelation: "v_sec_monitoring_dashboard"
      referencedColumns: ["customer_id"]
    }
                  ]
                },"seed_country_risk": {
                  Row: {
                    "central_bank": string,"country_code": string,"country_name": string,"created_at": string,"current_rating": string,"economic_score": number,"economic_shock_type": string,"economic_summary": string | null,"evidence_url": string,"policy_rate": number,"political_risk_type": string,"political_score": number,"political_summary": string | null,"previous_economic_score": number,"previous_policy_rate": number,"previous_political_score": number,"previous_rating": string,"rate_effective_date": string,"rating_agency": string,"rating_effective_date": string,"rating_outlook": string,"tariff_affected_countries": (string)[] | null,"tariff_affected_sectors": (string)[] | null,"tariff_change_percent": number | null,"tariff_effective_date": string | null,"tariff_summary": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "central_bank": string,"country_code": string,"country_name": string,"created_at"?: string,"current_rating": string,"economic_score": number,"economic_shock_type"?: string,"economic_summary"?: string | null,"evidence_url": string,"policy_rate": number,"political_risk_type"?: string,"political_score": number,"political_summary"?: string | null,"previous_economic_score": number,"previous_policy_rate": number,"previous_political_score": number,"previous_rating": string,"rate_effective_date": string,"rating_agency"?: string,"rating_effective_date": string,"rating_outlook"?: string,"tariff_affected_countries"?: (string)[] | null,"tariff_affected_sectors"?: (string)[] | null,"tariff_change_percent"?: number | null,"tariff_effective_date"?: string | null,"tariff_summary"?: string | null
                  }
                  Update: {
                    "central_bank"?: string,"country_code"?: string,"country_name"?: string,"created_at"?: string,"current_rating"?: string,"economic_score"?: number,"economic_shock_type"?: string,"economic_summary"?: string | null,"evidence_url"?: string,"policy_rate"?: number,"political_risk_type"?: string,"political_score"?: number,"political_summary"?: string | null,"previous_economic_score"?: number,"previous_policy_rate"?: number,"previous_political_score"?: number,"previous_rating"?: string,"rate_effective_date"?: string,"rating_agency"?: string,"rating_effective_date"?: string,"rating_outlook"?: string,"tariff_affected_countries"?: (string)[] | null,"tariff_affected_sectors"?: (string)[] | null,"tariff_change_percent"?: number | null,"tariff_effective_date"?: string | null,"tariff_summary"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"seed_fx_rates": {
                  Row: {
                    "currency": string,"days_ago": number,"rate": number
                  }
                  ComputedFields: never
                  Insert: {
                    "currency": string,"days_ago": number,"rate": number
                  }
                  Update: {
                    "currency"?: string,"days_ago"?: number,"rate"?: number
                  }
                  Relationships: [
                    
                  ]
                },"seed_industry_econ_signals": {
                  Row: {
                    "change_percent": number,"created_at": string,"id": string,"indicator": string,"observation_date": string,"period_days": number,"sector": string,"source_series": string
                  }
                  ComputedFields: never
                  Insert: {
                    "change_percent": number,"created_at"?: string,"id"?: string,"indicator": string,"observation_date": string,"period_days"?: number,"sector": string,"source_series": string
                  }
                  Update: {
                    "change_percent"?: number,"created_at"?: string,"id"?: string,"indicator"?: string,"observation_date"?: string,"period_days"?: number,"sector"?: string,"source_series"?: string
                  }
                  Relationships: [
                    
                  ]
                },"seed_industry_news": {
                  Row: {
                    "created_at": string,"disruption_type": string,"headline": string,"id": string,"published_date": string,"sector": string,"source": string,"summary": string,"url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"disruption_type": string,"headline": string,"id"?: string,"published_date": string,"sector": string,"source": string,"summary": string,"url"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"disruption_type"?: string,"headline"?: string,"id"?: string,"published_date"?: string,"sector"?: string,"source"?: string,"summary"?: string,"url"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"seed_news": {
                  Row: {
                    "company_name": string,"created_at": string,"customer_id": string,"headline": string,"id": string,"provider": string,"published_date": string,"relevance_score": number,"source": string,"summary": string,"url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "company_name": string,"created_at"?: string,"customer_id": string,"headline": string,"id"?: string,"provider"?: string,"published_date": string,"relevance_score"?: number,"source": string,"summary": string,"url"?: string | null
                  }
                  Update: {
                    "company_name"?: string,"created_at"?: string,"customer_id"?: string,"headline"?: string,"id"?: string,"provider"?: string,"published_date"?: string,"relevance_score"?: number,"source"?: string,"summary"?: string,"url"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "seed_news_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "seed_news_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_ar_aging_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "seed_news_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_customers_at_risk"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "seed_news_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_growth_opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "seed_news_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_payment_behaviour"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "seed_news_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_payment_behaviour_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "seed_news_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_sec_monitoring_dashboard"
      referencedColumns: ["customer_id"]
    }
                  ]
                },"seed_sec_filings": {
                  Row: {
                    "accession_number": string,"cik": string,"company_name": string,"created_at": string,"document_url": string,"filing_date": string,"filing_type": string,"id": string,"key_findings": string,"provider": string,"risk_signals": (string)[]
                  }
                  ComputedFields: never
                  Insert: {
                    "accession_number": string,"cik": string,"company_name": string,"created_at"?: string,"document_url": string,"filing_date": string,"filing_type": string,"id"?: string,"key_findings"?: string,"provider"?: string,"risk_signals"?: (string)[]
                  }
                  Update: {
                    "accession_number"?: string,"cik"?: string,"company_name"?: string,"created_at"?: string,"document_url"?: string,"filing_date"?: string,"filing_type"?: string,"id"?: string,"key_findings"?: string,"provider"?: string,"risk_signals"?: (string)[]
                  }
                  Relationships: [
                    
                  ]
                },"underwriting_baseline": {
                  Row: {
                    "application_id": string | null,"approved_at": string,"approved_by": string | null,"approved_limit_usd": number,"assumptions": NonNullable<Json>,"customer_id": string,"id": string,"memo": Json | null,"reason_codes": (string)[]
                  }
                  ComputedFields: never
                  Insert: {
                    "application_id"?: string | null,"approved_at"?: string,"approved_by"?: string | null,"approved_limit_usd": number,"assumptions"?: NonNullable<Json>,"customer_id": string,"id"?: string,"memo"?: Json | null,"reason_codes"?: (string)[]
                  }
                  Update: {
                    "application_id"?: string | null,"approved_at"?: string,"approved_by"?: string | null,"approved_limit_usd"?: number,"assumptions"?: NonNullable<Json>,"customer_id"?: string,"id"?: string,"memo"?: Json | null,"reason_codes"?: (string)[]
                  }
                  Relationships: [
                    {
      foreignKeyName: "underwriting_baseline_application_id_fkey"
      columns: ["application_id"]
isOneToOne: false
      referencedRelation: "credit_applications"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "underwriting_baseline_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "underwriting_baseline_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_ar_aging_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "underwriting_baseline_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_customers_at_risk"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "underwriting_baseline_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_growth_opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "underwriting_baseline_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_payment_behaviour"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "underwriting_baseline_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_payment_behaviour_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "underwriting_baseline_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_sec_monitoring_dashboard"
      referencedColumns: ["customer_id"]
    }
                  ]
                }
          }
          Views: {
            "sanctions_list_status": {
                  Row: {
                    "entry_count": number | null,"last_error": string | null,"last_error_at": string | null,"last_success_at": string | null,"list": string
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_ar_aging_current": {
                  Row: {
                    "account_manager": string | null,"bucket_1_30": number | null,"bucket_1_30_count": number | null,"bucket_31_60": number | null,"bucket_31_60_count": number | null,"bucket_61_90": number | null,"bucket_61_90_count": number | null,"bucket_over_90": number | null,"bucket_over_90_count": number | null,"company_name": string,"credit_limit": number,"current_amount": number | null,"current_count": number | null,"customer_id": string,"payment_terms_days": number,"pre_petition_amount": number | null,"risk_tier": string | null,"scenario": Database["public"]['Enums']["scenario_type"],"snapshot_date": string | null,"ticker": string | null,"total_invoice_count": number | null,"total_outstanding": number | null,"utilization_pct": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_ar_aging_portfolio": {
                  Row: {
                    "customer_count": number | null,"pct_1_30": number | null,"pct_31_60": number | null,"pct_61_90": number | null,"pct_current": number | null,"pct_over_90": number | null,"snapshot_date": string | null,"total_1_30": number | null,"total_31_60": number | null,"total_61_90": number | null,"total_bucket_1_30_count": number | null,"total_bucket_31_60_count": number | null,"total_bucket_61_90_count": number | null,"total_bucket_over_90_count": number | null,"total_current": number | null,"total_current_count": number | null,"total_outstanding": number | null,"total_over_90": number | null,"total_pre_petition": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_bankruptcy_claims": {
                  Row: {
                    "case_number": string,"chapter": number,"claimable_invoice_count": number | null,"claimable_total": number | null,"company_name": string,"court": string | null,"emergence_date_estimated": string | null,"estimated_recovery_amount": number | null,"estimated_recovery_rate": number | null,"filing_date": string,"proof_of_claim_amount": number | null,"proof_of_claim_filed": boolean | null,"status": Database["public"]['Enums']["bankruptcy_status"],"ticker": string | null,"total_pre_petition_claim": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_customers_at_risk": {
                  Row: {
                    "account_manager": string | null,"avg_days_early_late": number | null,"company_name": string,"credit_limit": number,"credit_rating_score": number | null,"current_exposure": number,"id": string,"max_days_overdue": number | null,"notes": string | null,"on_time_pct": number | null,"overdue_amount": number | null,"overdue_invoice_count": number | null,"scenario": Database["public"]['Enums']["scenario_type"],"ticker": string | null,"utilization_pct": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_fx_exposure_by_invoice": {
                  Row: {
                    "booking_rate": number | null,"company_name": string,"country_code": string,"currency": string | null,"customer_id": string,"days_to_expected_pay": number | null,"due_date": string,"expected_pay_date": string | null,"fx_delta_usd": number | null,"fx_hedged": boolean,"invoice_date": string | null,"invoice_id": string,"invoice_number": string,"is_demo": boolean,"native_outstanding": number | null,"rate_now": number,"rate_now_date": string,"sensitivity_10pct_usd": number | null,"usd_at_booking": number,"usd_now": number | null,"usd_value_change_pct": number | null,"window_days": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "invoices_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoices_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_ar_aging_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "invoices_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_customers_at_risk"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoices_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_growth_opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoices_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_payment_behaviour"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "invoices_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_payment_behaviour_current"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "invoices_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "v_sec_monitoring_dashboard"
      referencedColumns: ["customer_id"]
    }
                  ]
                },"v_growth_opportunities": {
                  Row: {
                    "account_manager": string | null,"backlog_amount": number | null,"company_name": string,"credit_limit": number,"current_exposure": number,"growth_trajectory": string | null,"id": string,"rationale": string | null,"recent_milestones": (string)[] | null,"recommended_new_limit": number | null,"revenue_growth_yoy": number | null,"ticker": string | null,"upsell_opportunity": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_overdue_invoices": {
                  Row: {
                    "account_manager": string | null,"amount_outstanding": number | null,"amount_paid": number,"claimable": boolean | null,"company_name": string,"days_overdue": number,"due_date": string,"dunning_stage": Database["public"]['Enums']["dunning_stage"] | null,"escalated_to_collections": boolean | null,"invoice_amount": number,"invoice_date": string | null,"invoice_number": string,"risk_tier": string | null,"scenario": Database["public"]['Enums']["scenario_type"],"status": Database["public"]['Enums']["invoice_status"],"ticker": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_payment_behaviour": {
                  Row: {
                    "account_manager": string | null,"avg_days_early_late": number | null,"avg_days_to_pay": number | null,"avg_days_to_pay_last_6mo": number | null,"avg_days_to_pay_prior_6mo": number | null,"company_name": string,"customer_id": string,"last_payment_amount": number | null,"last_payment_date": string | null,"on_time_payment_pct": number | null,"payment_terms_days": number,"ticker": string | null,"total_paid_12mo": number | null,"total_paid_all_time": number | null,"total_payments": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_payment_behaviour_current": {
                  Row: {
                    "all_time_on_time_rate": number | null,"company_name": string,"credit_limit": number,"current_avg_days_late": number | null,"current_exposure": number,"current_on_time_rate": number | null,"current_stddev_days": number | null,"current_txn_count": number | null,"customer_id": string,"delta_days_late": number | null,"deterioration_severity": string | null,"has_sufficient_data": boolean | null,"improvement_severity": string | null,"payment_health": string | null,"payment_terms_days": number,"prior_avg_days_late": number | null,"prior_txn_count": number | null,"scenario": Database["public"]['Enums']["scenario_type"],"sector": string,"total_txn_count": number | null,"volatility_severity": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_payment_behaviour_portfolio": {
                  Row: {
                    "avg_days_early_late": number | null,"avg_days_to_pay": number | null,"customer_count": number | null,"last_payment_date": string | null,"on_time_payment_pct": number | null,"total_paid_12mo": number | null,"total_paid_all_time": number | null,"total_payments": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_portfolio_overview": {
                  Row: {
                    "avg_credit_limit": number | null,"bankruptcy_count": number | null,"credit_deterioration_count": number | null,"growth_count": number | null,"high_risk_count": number | null,"negative_news_count": number | null,"normal_count": number | null,"payment_issues_count": number | null,"portfolio_utilization_pct": number | null,"sec_monitoring_count": number | null,"total_credit_limits": number | null,"total_customers": number | null,"total_exposure": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_sec_monitoring_dashboard": {
                  Row: {
                    "alert_action_taken": string | null,"alert_date": string | null,"alert_triggered": boolean | null,"cik": string,"company_name": string,"customer_id": string,"last_10k_date": string | null,"last_10q_date": string | null,"last_8k_date": string | null,"monitoring_active": boolean | null,"next_scheduled_review": string | null,"risk_signals_detected": (string)[] | null,"ticker": string | null,"total_filings": number | null,"unreviewed_filings": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "current_app_role":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"fn_increment_ip_question_count":
{ Args: { "p_ip_address": string }; Returns: number
                           },
"fn_increment_ip_reset_count":
{ Args: { "p_ip_address": string }; Returns: number
                           },
"fn_multi_signal_convergence":
{ Args: { "p_is_demo": boolean }; Returns: {
              "agents": (string)[],"company_name": string,"customer_id": string,"distinct_agent_count": number,"event_count": number,"latest_event_date": string,"max_severity_score": number
            }[]
                           },
"fn_rank_portfolio_risk":
{ Args: Record<PropertyKey, never>; Returns: {
              "company_name": string,"company_type": string,"credit_limit": number,"credit_rating_raw": string,"credit_rating_score": number,"credit_rating_source": string,"current_exposure": number,"id": string,"is_high_risk": boolean,"latest_event_date": string,"payment_health": string,"payment_on_time_rate": number,"payment_trend": string,"recent_severity_sum": number,"risk_tags": (string)[],"scenario": Database["public"]['Enums']["scenario_type"]
            }[]
                           },
"fn_recalculate_exposure":
{ Args: { "p_customer_id": string }; Returns: undefined
                           },
"fn_refresh_all_ar_aging":
{ Args: { "p_as_of"?: string }; Returns: number
                           },
"fn_refresh_ar_aging":
{ Args: { "p_as_of"?: string,"p_customer_id": string }; Returns: undefined
                           },
"fn_reset_demo_invoice_dates":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"fn_reset_demo_payment_dates":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"fn_sanctions_candidates":
{ Args: { "p_min_similarity"?: number,"p_names": (string)[] }; Returns: {
              "aliases": (string)[],"country_code": string,"date_of_birth": string,"entry_type": string,"list": string,"list_id": string,"name": string
            }[]
                           },
"fn_sanctions_swap":
{ Args: { "p_min_ratio"?: number,"p_run_id": number }; Returns: number
                           },
"fn_trigger_sanctions_sync":
{ Args: { "p_list": string }; Returns: number
                           },
"naics_to_sector":
{ Args: { "naics": string }; Returns: string
                           },
"show_limit":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"show_trgm":
{ Args: { "": string }; Returns: (string)[]
                           }
          }
          Enums: {
            "bankruptcy_status": "FILED"|"CONFIRMED_PLAN"|"CHAPTER_7_CONVERTED"|"ASSETS_SOLD"|"EMERGED"|"DISMISSED","credit_action_type": "PLACED_ON_WATCH_LIST"|"REMOVED_FROM_WATCH_LIST"|"CREDIT_HOLD_PLACED"|"CREDIT_HOLD_RELEASED"|"CREDIT_LIMIT_REDUCTION"|"CREDIT_LIMIT_INCREASE"|"CREDIT_LIMIT_REVIEW"|"DUNNING_LETTER_STAGE_1"|"DUNNING_LETTER_STAGE_2"|"DUNNING_LETTER_STAGE_3"|"DUNNING_LETTER_STAGE_4"|"REFERRED_TO_COLLECTIONS"|"PROOF_OF_CLAIM_FILED"|"COD_ONLY_POLICY_SET"|"PARENT_GUARANTEE_REQUEST_SENT"|"CREDIT_REVIEW_INITIATED"|"LEGAL_COUNSEL_ENGAGED"|"PAYMENT_PLAN_DISCUSSION"|"PAYMENT_PLAN_AGREED"|"SEC_ALERT_TRIGGERED"|"NEWS_ALERT_TRIGGERED"|"NEWS_MONITORING_INCREASED"|"FINANCIALS_REQUEST_SENT"|"EXECUTIVE_ESCALATION"|"OTHER"|"NEW_CREDIT_LIMIT","credit_event_type": "RATING_DOWNGRADE"|"RATING_UPGRADE"|"OUTLOOK_CHANGE"|"EARNINGS_MISS"|"EARNINGS_BEAT"|"COVENANT_WAIVER"|"COVENANT_BREACH"|"RESTRUCTURING_ANNOUNCEMENT"|"MANAGEMENT_CHANGE"|"OWNERSHIP_CHANGE"|"SEC_INVESTIGATION"|"GOODWILL_IMPAIRMENT"|"CAPITAL_RAISE"|"LOAN_AMENDMENT"|"CONTRACT_LOSS"|"CONTRACT_WIN"|"GOING_CONCERN"|"CREDIT_FACILITY_AMENDMENT"|"OTHER","dunning_stage": "1"|"2"|"3"|"4","invoice_status": "current"|"overdue"|"pre_petition"|"paid"|"written_off"|"disputed"|"open","market_cap_tier": "large_cap"|"mid_cap"|"small_cap"|"private"|"private_subsidiary","payment_method": "wire_transfer"|"ach"|"check"|"credit_card"|"offset"|"partial"|"other"|"wire","scenario_type": "normal_operations"|"payment_issues"|"credit_deterioration"|"negative_news"|"bankruptcy"|"growth_opportunity"|"sec_filing_monitoring"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "bankruptcy_status": ["FILED", "CONFIRMED_PLAN", "CHAPTER_7_CONVERTED", "ASSETS_SOLD", "EMERGED", "DISMISSED"],"credit_action_type": ["PLACED_ON_WATCH_LIST", "REMOVED_FROM_WATCH_LIST", "CREDIT_HOLD_PLACED", "CREDIT_HOLD_RELEASED", "CREDIT_LIMIT_REDUCTION", "CREDIT_LIMIT_INCREASE", "CREDIT_LIMIT_REVIEW", "DUNNING_LETTER_STAGE_1", "DUNNING_LETTER_STAGE_2", "DUNNING_LETTER_STAGE_3", "DUNNING_LETTER_STAGE_4", "REFERRED_TO_COLLECTIONS", "PROOF_OF_CLAIM_FILED", "COD_ONLY_POLICY_SET", "PARENT_GUARANTEE_REQUEST_SENT", "CREDIT_REVIEW_INITIATED", "LEGAL_COUNSEL_ENGAGED", "PAYMENT_PLAN_DISCUSSION", "PAYMENT_PLAN_AGREED", "SEC_ALERT_TRIGGERED", "NEWS_ALERT_TRIGGERED", "NEWS_MONITORING_INCREASED", "FINANCIALS_REQUEST_SENT", "EXECUTIVE_ESCALATION", "OTHER", "NEW_CREDIT_LIMIT"],"credit_event_type": ["RATING_DOWNGRADE", "RATING_UPGRADE", "OUTLOOK_CHANGE", "EARNINGS_MISS", "EARNINGS_BEAT", "COVENANT_WAIVER", "COVENANT_BREACH", "RESTRUCTURING_ANNOUNCEMENT", "MANAGEMENT_CHANGE", "OWNERSHIP_CHANGE", "SEC_INVESTIGATION", "GOODWILL_IMPAIRMENT", "CAPITAL_RAISE", "LOAN_AMENDMENT", "CONTRACT_LOSS", "CONTRACT_WIN", "GOING_CONCERN", "CREDIT_FACILITY_AMENDMENT", "OTHER"],"dunning_stage": ["1", "2", "3", "4"],"invoice_status": ["current", "overdue", "pre_petition", "paid", "written_off", "disputed", "open"],"market_cap_tier": ["large_cap", "mid_cap", "small_cap", "private", "private_subsidiary"],"payment_method": ["wire_transfer", "ach", "check", "credit_card", "offset", "partial", "other", "wire"],"scenario_type": ["normal_operations", "payment_issues", "credit_deterioration", "negative_news", "bankruptcy", "growth_opportunity", "sec_filing_monitoring"]
          }
        }
} as const
