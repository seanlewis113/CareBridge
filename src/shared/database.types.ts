export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string | null;
          display_name: string;
          persona: 'mother' | 'admin' | 'family_caregiver' | 'hired_caregiver';
          avatar_url: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          display_name: string;
          persona: 'mother' | 'admin' | 'family_caregiver' | 'hired_caregiver';
          avatar_url?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
      };
      app_settings: {
        Row: {
          id: string;
          mother_name: string;
          mother_pin_hash: string | null;
          admin_switch_pin_hash: string | null;
          financial_pin_hash: string | null;
          text_scale: number;
          google_calendar_id: string | null;
          google_refresh_token: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          mother_name?: string;
          mother_pin_hash?: string | null;
          admin_switch_pin_hash?: string | null;
          financial_pin_hash?: string | null;
          text_scale?: number;
          google_calendar_id?: string | null;
          google_refresh_token?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['app_settings']['Insert']>;
      };
      calendar_events: {
        Row: {
          id: string;
          google_event_id: string | null;
          title: string;
          start_at: string;
          end_at: string;
          description: string | null;
          created_by: string | null;
          synced_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          google_event_id?: string | null;
          title: string;
          start_at: string;
          end_at: string;
          description?: string | null;
          created_by?: string | null;
          synced_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['calendar_events']['Insert']>;
      };
      tasks: {
        Row: {
          id: string;
          title: string;
          description: string | null;
          due_at: string | null;
          visit_specific: boolean;
          open_slot: boolean;
          show_on_mother_hub: boolean;
          status: 'pending' | 'in_progress' | 'completed';
          checklist: Json;
          created_by: string | null;
          claimed_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          description?: string | null;
          due_at?: string | null;
          visit_specific?: boolean;
          open_slot?: boolean;
          show_on_mother_hub?: boolean;
          status?: 'pending' | 'in_progress' | 'completed';
          checklist?: Json;
          created_by?: string | null;
          claimed_by?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['tasks']['Insert']>;
      };
      task_assignments: {
        Row: {
          id: string;
          task_id: string;
          profile_id: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          profile_id: string;
        };
        Update: Partial<Database['public']['Tables']['task_assignments']['Insert']>;
      };
      reminders: {
        Row: {
          id: string;
          body: string;
          priority: 'low' | 'normal' | 'high';
          active: boolean;
          show_on_mother_hub: boolean;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          body: string;
          priority?: 'low' | 'normal' | 'high';
          active?: boolean;
          show_on_mother_hub?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['reminders']['Insert']>;
      };
      visit_notes: {
        Row: {
          id: string;
          author_id: string;
          visit_date: string;
          mood: string | null;
          meals: string | null;
          meds: string | null;
          activities: string | null;
          concerns: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          author_id: string;
          visit_date: string;
          mood?: string | null;
          meals?: string | null;
          meds?: string | null;
          activities?: string | null;
          concerns?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['visit_notes']['Insert']>;
      };
      documents: {
        Row: {
          id: string;
          name: string;
          storage_path: string;
          folder: 'medical' | 'legal' | 'daily_routine' | 'emergency';
          uploaded_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          storage_path: string;
          folder: 'medical' | 'legal' | 'daily_routine' | 'emergency';
          uploaded_by?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['documents']['Insert']>;
      };
      family_updates: {
        Row: {
          id: string;
          body: string;
          author_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          body: string;
          author_id: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['family_updates']['Insert']>;
      };
      financial_accounts: {
        Row: {
          id: string;
          institution: string;
          account_name: string;
          plaid_item_id: string | null;
          plaid_access_token: string | null;
          plaid_transactions_cursor: string | null;
          last_balance: number | null;
          last_synced: string | null;
          display_on_mother_hub: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          institution: string;
          account_name: string;
          plaid_item_id?: string | null;
          plaid_access_token?: string | null;
          plaid_transactions_cursor?: string | null;
          last_balance?: number | null;
          last_synced?: string | null;
          display_on_mother_hub?: boolean;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['financial_accounts']['Insert']>;
      };
      transactions: {
        Row: {
          id: string;
          account_id: string;
          date: string;
          description: string;
          amount: number;
          category: string | null;
          category_override: boolean;
          import_source: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          date: string;
          description: string;
          amount: number;
          category?: string | null;
          category_override?: boolean;
          import_source: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['transactions']['Insert']>;
      };
      financial_access_log: {
        Row: {
          id: string;
          profile_id: string | null;
          action: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id?: string | null;
          action: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['financial_access_log']['Insert']>;
      };
    };
    Views: Record<string, never>;
    Functions: {
      verify_mother_pin: {
        Args: { input_pin: string };
        Returns: boolean;
      };
      verify_admin_switch_pin: {
        Args: { input_pin: string };
        Returns: boolean;
      };
    };
    Enums: {
      persona_type: 'mother' | 'admin' | 'family_caregiver' | 'hired_caregiver';
      task_status: 'pending' | 'in_progress' | 'completed';
      document_folder: 'medical' | 'legal' | 'daily_routine' | 'emergency';
    };
  };
}
