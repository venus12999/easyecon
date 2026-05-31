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
          password_hash: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          frq_grader_prompt?: string | null
          id?: number
          password_hash: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          frq_grader_prompt?: string | null
          id?: number
          password_hash?: string
          updated_at?: string
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
      paper_frqs: {
        Row: {
          content: string
          created_at: string
          id: string
          image_text: string | null
          image_url: string | null
          max_score: number
          paper_id: string
          rubric_note: string | null
          sort_order: number
          title: string | null
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          image_text?: string | null
          image_url?: string | null
          max_score?: number
          paper_id: string
          rubric_note?: string | null
          sort_order: number
          title?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          image_text?: string | null
          image_url?: string | null
          max_score?: number
          paper_id?: string
          rubric_note?: string | null
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
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string
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
      wrong_questions: {
        Row: {
          added_at: string
          question_id: string
          user_id: string
        }
        Insert: {
          added_at?: string
          question_id: string
          user_id: string
        }
        Update: {
          added_at?: string
          question_id?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
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
      feedback_category: ["bug", "suggestion"],
      feedback_status: ["new", "in_progress", "resolved"],
      question_status: ["draft", "published"],
      question_type: ["basic", "application", "pitfall"],
    },
  },
} as const
