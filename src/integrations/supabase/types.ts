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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_settings: {
        Row: {
          created_at: string
          frq_grader_prompt: string | null
          id: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          frq_grader_prompt?: string | null
          id?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          frq_grader_prompt?: string | null
          id?: number
          updated_at?: string
        }
        Relationships: []
      }
      ai_daily_usage: {
        Row: {
          ai_explain_count: number
          created_at: string
          frq_grade_count: number
          id: string
          updated_at: string
          usage_date: string
          user_id: string
        }
        Insert: {
          ai_explain_count?: number
          created_at?: string
          frq_grade_count?: number
          id?: string
          updated_at?: string
          usage_date?: string
          user_id: string
        }
        Update: {
          ai_explain_count?: number
          created_at?: string
          frq_grade_count?: number
          id?: string
          updated_at?: string
          usage_date?: string
          user_id?: string
        }
        Relationships: []
      }
      answer_attempts: {
        Row: {
          created_at: string
          id: string
          is_correct: boolean
          knowledge_point_id: string
          mode: string
          picked_answer: string | null
          question_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_correct: boolean
          knowledge_point_id: string
          mode?: string
          picked_answer?: string | null
          question_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_correct?: boolean
          knowledge_point_id?: string
          mode?: string
          picked_answer?: string | null
          question_id?: string
          user_id?: string
        }
        Relationships: []
      }
      feedback: {
        Row: {
          admin_note: string | null
          category: Database["public"]["Enums"]["feedback_category"]
          contact: string | null
          created_at: string
          id: string
          message: string
          page_url: string | null
          status: Database["public"]["Enums"]["feedback_status"]
          updated_at: string
        }
        Insert: {
          admin_note?: string | null
          category?: Database["public"]["Enums"]["feedback_category"]
          contact?: string | null
          created_at?: string
          id?: string
          message: string
          page_url?: string | null
          status?: Database["public"]["Enums"]["feedback_status"]
          updated_at?: string
        }
        Update: {
          admin_note?: string | null
          category?: Database["public"]["Enums"]["feedback_category"]
          contact?: string | null
          created_at?: string
          id?: string
          message?: string
          page_url?: string | null
          status?: Database["public"]["Enums"]["feedback_status"]
          updated_at?: string
        }
        Relationships: []
      }
      frq_drafts: {
        Row: {
          answer_file_kind: string | null
          answer_file_name: string | null
          answer_file_url: string | null
          answer_text: string | null
          frq_id: string
          paper_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          answer_file_kind?: string | null
          answer_file_name?: string | null
          answer_file_url?: string | null
          answer_text?: string | null
          frq_id: string
          paper_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          answer_file_kind?: string | null
          answer_file_name?: string | null
          answer_file_url?: string | null
          answer_text?: string | null
          frq_id?: string
          paper_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "frq_drafts_frq_id_fkey"
            columns: ["frq_id"]
            isOneToOne: false
            referencedRelation: "paper_frqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "frq_drafts_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "mock_papers"
            referencedColumns: ["id"]
          },
        ]
      }
      frq_submissions: {
        Row: {
          ai_breakdown: Json | null
          ai_max_score: number | null
          ai_overall: string | null
          ai_score: number | null
          ai_suggestions: string | null
          answer_file_kind: string | null
          answer_file_url: string | null
          answer_text: string | null
          created_at: string
          frq_id: string
          id: string
          mode: string
          paper_id: string
          user_id: string
        }
        Insert: {
          ai_breakdown?: Json | null
          ai_max_score?: number | null
          ai_overall?: string | null
          ai_score?: number | null
          ai_suggestions?: string | null
          answer_file_kind?: string | null
          answer_file_url?: string | null
          answer_text?: string | null
          created_at?: string
          frq_id: string
          id?: string
          mode: string
          paper_id: string
          user_id: string
        }
        Update: {
          ai_breakdown?: Json | null
          ai_max_score?: number | null
          ai_overall?: string | null
          ai_score?: number | null
          ai_suggestions?: string | null
          answer_file_kind?: string | null
          answer_file_url?: string | null
          answer_text?: string | null
          created_at?: string
          frq_id?: string
          id?: string
          mode?: string
          paper_id?: string
          user_id?: string
        }
        Relationships: []
      }
      knowledge_points: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name_en: string
          name_zh: string
          slug: string
          sort_order: number
          unit: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name_en: string
          name_zh: string
          slug: string
          sort_order?: number
          unit: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name_en?: string
          name_zh?: string
          slug?: string
          sort_order?: number
          unit?: number
          updated_at?: string
        }
        Relationships: []
      }
      membership_adjustments: {
        Row: {
          admin_user_id: string
          created_at: string
          days_granted: number
          ends_at: string
          id: string
          note: string | null
          starts_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_user_id: string
          created_at?: string
          days_granted: number
          ends_at: string
          id?: string
          note?: string | null
          starts_at: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_user_id?: string
          created_at?: string
          days_granted?: number
          ends_at?: string
          id?: string
          note?: string | null
          starts_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      mock_attempts: {
        Row: {
          correct: number
          created_at: string
          detail: Json
          duration_seconds: number
          id: string
          total: number
          user_id: string
        }
        Insert: {
          correct: number
          created_at?: string
          detail?: Json
          duration_seconds: number
          id?: string
          total: number
          user_id: string
        }
        Update: {
          correct?: number
          created_at?: string
          detail?: Json
          duration_seconds?: number
          id?: string
          total?: number
          user_id?: string
        }
        Relationships: []
      }
      mock_exam_starts: {
        Row: {
          environment: string
          exam_key: string
          id: string
          started_at: string
          user_id: string
        }
        Insert: {
          environment: string
          exam_key: string
          id?: string
          started_at?: string
          user_id: string
        }
        Update: {
          environment?: string
          exam_key?: string
          id?: string
          started_at?: string
          user_id?: string
        }
        Relationships: []
      }
      mock_papers: {
        Row: {
          break_seconds: number
          created_at: string
          description: string | null
          frq_seconds: number
          id: string
          slug: string
          sort_order: number
          title: string
          total_seconds: number
          year: number | null
        }
        Insert: {
          break_seconds?: number
          created_at?: string
          description?: string | null
          frq_seconds?: number
          id?: string
          slug: string
          sort_order?: number
          title: string
          total_seconds?: number
          year?: number | null
        }
        Update: {
          break_seconds?: number
          created_at?: string
          description?: string | null
          frq_seconds?: number
          id?: string
          slug?: string
          sort_order?: number
          title?: string
          total_seconds?: number
          year?: number | null
        }
        Relationships: []
      }
      paper_frq_rubrics: {
        Row: {
          created_at: string
          frq_id: string
          rubric_note: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          frq_id: string
          rubric_note?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          frq_id?: string
          rubric_note?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paper_frq_rubrics_frq_id_fkey"
            columns: ["frq_id"]
            isOneToOne: true
            referencedRelation: "paper_frqs"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_frqs: {
        Row: {
          content: string
          created_at: string
          exclude_from_pool: boolean
          id: string
          image_text: string | null
          image_url: string | null
          max_score: number
          paper_id: string
          sort_order: number
          title: string | null
        }
        Insert: {
          content: string
          created_at?: string
          exclude_from_pool?: boolean
          id?: string
          image_text?: string | null
          image_url?: string | null
          max_score?: number
          paper_id: string
          sort_order: number
          title?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          exclude_from_pool?: boolean
          id?: string
          image_text?: string | null
          image_url?: string | null
          max_score?: number
          paper_id?: string
          sort_order?: number
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "paper_frqs_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "mock_papers"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_questions: {
        Row: {
          paper_id: string
          question_id: string
          sort_order: number
        }
        Insert: {
          paper_id: string
          question_id: string
          sort_order: number
        }
        Update: {
          paper_id?: string
          question_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "paper_questions_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "mock_papers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paper_questions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string
          exam_date: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email: string
          exam_date?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string
          exam_date?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      questions: {
        Row: {
          correct_answer: string
          created_at: string
          difficulty: number
          exclude_from_pool: boolean
          explanation: string
          id: string
          image_url: string | null
          knowledge_point_id: string
          option_a: string
          option_b: string
          option_c: string
          option_d: string
          option_e: string | null
          pitfall_note: string | null
          status: Database["public"]["Enums"]["question_status"]
          stem: string
          term_tags: string[] | null
          type: Database["public"]["Enums"]["question_type"]
          updated_at: string
        }
        Insert: {
          correct_answer: string
          created_at?: string
          difficulty?: number
          exclude_from_pool?: boolean
          explanation: string
          id?: string
          image_url?: string | null
          knowledge_point_id: string
          option_a: string
          option_b: string
          option_c: string
          option_d: string
          option_e?: string | null
          pitfall_note?: string | null
          status?: Database["public"]["Enums"]["question_status"]
          stem: string
          term_tags?: string[] | null
          type?: Database["public"]["Enums"]["question_type"]
          updated_at?: string
        }
        Update: {
          correct_answer?: string
          created_at?: string
          difficulty?: number
          exclude_from_pool?: boolean
          explanation?: string
          id?: string
          image_url?: string | null
          knowledge_point_id?: string
          option_a?: string
          option_b?: string
          option_c?: string
          option_d?: string
          option_e?: string | null
          pitfall_note?: string | null
          status?: Database["public"]["Enums"]["question_status"]
          stem?: string
          term_tags?: string[] | null
          type?: Database["public"]["Enums"]["question_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "questions_knowledge_point_id_fkey"
            columns: ["knowledge_point_id"]
            isOneToOne: false
            referencedRelation: "knowledge_points"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          environment: string
          id: string
          paddle_customer_id: string
          paddle_subscription_id: string
          price_id: string
          product_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          paddle_customer_id: string
          paddle_subscription_id: string
          price_id: string
          product_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          paddle_customer_id?: string
          paddle_subscription_id?: string
          price_id?: string
          product_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      terms: {
        Row: {
          confusable_with: string[] | null
          created_at: string
          definition: string
          id: string
          term_en: string
          term_zh: string
          unit: number | null
          updated_at: string
        }
        Insert: {
          confusable_with?: string[] | null
          created_at?: string
          definition: string
          id?: string
          term_en: string
          term_zh: string
          unit?: number | null
          updated_at?: string
        }
        Update: {
          confusable_with?: string[] | null
          created_at?: string
          definition?: string
          id?: string
          term_en?: string
          term_zh?: string
          unit?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      tutor_orders: {
        Row: {
          amount_total: number | null
          created_at: string
          currency_code: string | null
          environment: string
          id: string
          membership_days_granted: number
          membership_ends_at: string | null
          paddle_subscription_id: string | null
          paddle_transaction_id: string
          price_external_id: string
          product_external_id: string | null
          quantity: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_total?: number | null
          created_at?: string
          currency_code?: string | null
          environment?: string
          id?: string
          membership_days_granted?: number
          membership_ends_at?: string | null
          paddle_subscription_id?: string | null
          paddle_transaction_id: string
          price_external_id: string
          product_external_id?: string | null
          quantity?: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_total?: number | null
          created_at?: string
          currency_code?: string | null
          environment?: string
          id?: string
          membership_days_granted?: number
          membership_ends_at?: string | null
          paddle_subscription_id?: string | null
          paddle_transaction_id?: string
          price_external_id?: string
          product_external_id?: string | null
          quantity?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tutor_trial_bookings: {
        Row: {
          contact: string | null
          created_at: string
          id: string
          note: string | null
          preferred_time: string | null
          scheduled_at: string | null
          status: string
          teacher: string
          updated_at: string
          user_id: string
        }
        Insert: {
          contact?: string | null
          created_at?: string
          id?: string
          note?: string | null
          preferred_time?: string | null
          scheduled_at?: string | null
          status?: string
          teacher: string
          updated_at?: string
          user_id: string
        }
        Update: {
          contact?: string | null
          created_at?: string
          id?: string
          note?: string | null
          preferred_time?: string | null
          scheduled_at?: string | null
          status?: string
          teacher?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wrong_questions: {
        Row: {
          added_at: string
          question_id: string
          source: string
          user_id: string
        }
        Insert: {
          added_at?: string
          question_id: string
          source?: string
          user_id: string
        }
        Update: {
          added_at?: string
          question_id?: string
          source?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      consume_ai_quota: {
        Args: { p_environment: string; p_kind: string; p_user_id: string }
        Returns: {
          allowed: boolean
          is_pro: boolean
          quota: number
          used: number
        }[]
      }
      consume_mock_access: {
        Args: { p_environment: string; p_exam_key: string; p_user_id: string }
        Returns: {
          allowed: boolean
          is_pro: boolean
          next_available_at: string
        }[]
      }
      get_taken_tutor_slots: {
        Args: { p_day: string; p_teacher: string }
        Returns: {
          scheduled_at: string
        }[]
      }
      has_active_subscription: {
        Args: { check_env?: string; user_uuid: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      release_ai_quota: {
        Args: { p_kind: string; p_user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "user" | "teacher"
      feedback_category: "bug" | "suggestion"
      feedback_status: "new" | "in_progress" | "resolved"
      question_status: "draft" | "published"
      question_type: "basic" | "application" | "pitfall"
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
      app_role: ["admin", "user", "teacher"],
      feedback_category: ["bug", "suggestion"],
      feedback_status: ["new", "in_progress", "resolved"],
      question_status: ["draft", "published"],
      question_type: ["basic", "application", "pitfall"],
    },
  },
} as const
