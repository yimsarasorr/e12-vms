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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      access_tickets: {
        Row: {
          building_id: string | null
          created_at: string | null
          current_usage: number | null
          expires_at: string | null
          floor: number | null
          host_id: string | null
          id: string
          invite_code: string | null
          max_usage: number | null
          pass_type: string | null
          room_id: string | null
          status: string | null
          valid_from: string | null
        }
        Insert: {
          building_id?: string | null
          created_at?: string | null
          current_usage?: number | null
          expires_at?: string | null
          floor?: number | null
          host_id?: string | null
          id?: string
          invite_code?: string | null
          max_usage?: number | null
          pass_type?: string | null
          room_id?: string | null
          status?: string | null
          valid_from?: string | null
        }
        Update: {
          building_id?: string | null
          created_at?: string | null
          current_usage?: number | null
          expires_at?: string | null
          floor?: number | null
          host_id?: string | null
          id?: string
          invite_code?: string | null
          max_usage?: number | null
          pass_type?: string | null
          room_id?: string | null
          status?: string | null
          valid_from?: string | null
        }
        Relationships: []
      }
      activity_logs: {
        Row: {
          action: string | null
          category: string | null
          changes: Json | null
          created_at: string | null
          detail: string | null
          entity_id: string | null
          id: number
          log_type: string | null
          meta: Json | null
          status: string | null
          time_display: string | null
          type: string | null
          user: string | null
        }
        Insert: {
          action?: string | null
          category?: string | null
          changes?: Json | null
          created_at?: string | null
          detail?: string | null
          entity_id?: string | null
          id?: number
          log_type?: string | null
          meta?: Json | null
          status?: string | null
          time_display?: string | null
          type?: string | null
          user?: string | null
        }
        Update: {
          action?: string | null
          category?: string | null
          changes?: Json | null
          created_at?: string | null
          detail?: string | null
          entity_id?: string | null
          id?: number
          log_type?: string | null
          meta?: Json | null
          status?: string | null
          time_display?: string | null
          type?: string | null
          user?: string | null
        }
        Relationships: []
      }
      assets: {
        Row: {
          floor_id: string | null
          id: string
          name: string | null
          status: string | null
          type: string
        }
        Insert: {
          floor_id?: string | null
          id: string
          name?: string | null
          status?: string | null
          type: string
        }
        Update: {
          floor_id?: string | null
          id?: string
          name?: string | null
          status?: string | null
          type?: string
        }
        Relationships: []
      }
      buildings: {
        Row: {
          address: string | null
          allowed_user_types: Json | null
          category: string | null
          close_time: string | null
          id: string
          images: Json | null
          is_active: boolean | null
          lat: number | null
          lng: number | null
          map_x: string | null
          map_y: string | null
          name: string | null
          open_time: string | null
          site_id: number
          user_types: string | null
        }
        Insert: {
          address?: string | null
          allowed_user_types?: Json | null
          category?: string | null
          close_time?: string | null
          id: string
          images?: Json | null
          is_active?: boolean | null
          lat?: number | null
          lng?: number | null
          map_x?: string | null
          map_y?: string | null
          name?: string | null
          open_time?: string | null
          site_id: number
          user_types?: string | null
        }
        Update: {
          address?: string | null
          allowed_user_types?: Json | null
          category?: string | null
          close_time?: string | null
          id?: string
          images?: Json | null
          is_active?: boolean | null
          lat?: number | null
          lng?: number | null
          map_x?: string | null
          map_y?: string | null
          name?: string | null
          open_time?: string | null
          site_id?: number
          user_types?: string | null
        }
        Relationships: []
      }
      floors: {
        Row: {
          building_id: string | null
          id: string
          layout_data: Json | null
          level_order: number | null
          name: string | null
        }
        Insert: {
          building_id?: string | null
          id: string
          layout_data?: Json | null
          level_order?: number | null
          name?: string | null
        }
        Update: {
          building_id?: string | null
          id?: string
          layout_data?: Json | null
          level_order?: number | null
          name?: string | null
        }
        Relationships: []
      }
      gate_attendance: {
        Row: {
          access_id: string | null
          check_in_at: string | null
          check_out_at: string | null
          id: string
          location_id: string | null
          profile_id: string | null
          status: string | null
        }
        Insert: {
          access_id?: string | null
          check_in_at?: string | null
          check_out_at?: string | null
          id?: string
          location_id?: string | null
          profile_id?: string | null
          status?: string | null
        }
        Update: {
          access_id?: string | null
          check_in_at?: string | null
          check_out_at?: string | null
          id?: string
          location_id?: string | null
          profile_id?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gate_attendance_access_id_fkey"
            columns: ["access_id"]
            isOneToOne: false
            referencedRelation: "user_door_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gate_attendance_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar: string | null
          created_at: string | null
          email: string | null
          id: string
          line_id: string | null
          name: string | null
          phone: string | null
          role: string | null
          role_level: number | null
          updated_at: string | null
        }
        Insert: {
          avatar?: string | null
          created_at?: string | null
          email?: string | null
          id: string
          line_id?: string | null
          name?: string | null
          phone?: string | null
          role?: string | null
          role_level?: number | null
          updated_at?: string | null
        }
        Update: {
          avatar?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          line_id?: string | null
          name?: string | null
          phone?: string | null
          role?: string | null
          role_level?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      user_bookmarks: {
        Row: {
          building_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          building_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          building_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_bookmarks_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
        ]
      }
      user_door_access: {
        Row: {
          door_id: string | null
          granted_at: string | null
          granted_by: string | null
          id: string
          is_granted: boolean | null
          profile_id: string | null
          valid_until: string | null
        }
        Insert: {
          door_id?: string | null
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          is_granted?: boolean | null
          profile_id?: string | null
          valid_until?: string | null
        }
        Update: {
          door_id?: string | null
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          is_granted?: boolean | null
          profile_id?: string | null
          valid_until?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_invite_code: {
        Args: { p_code: string; p_visitor_id: string }
        Returns: Json
      }
      insert_activity_log: {
        Args: {
          p_action: string
          p_category: string
          p_changes?: Json
          p_detail?: string
          p_entity_id?: string
          p_log_type: string
          p_meta?: Json
          p_status: string
          p_type?: string
          p_user: string
        }
        Returns: undefined
      }
      process_gate_access: {
        Args: {
          p_access_id: string
          p_door_id: string
          p_scanner_name?: string
        }
        Returns: Json
      }
      update_profile_with_log: {
        Args: {
          p_actor_id: string
          p_actor_name: string
          p_updates: Json
          p_user_id: string
        }
        Returns: {
          avatar: string | null
          created_at: string | null
          email: string | null
          id: string
          line_id: string | null
          name: string | null
          phone: string | null
          role: string | null
          role_level: number | null
          updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
