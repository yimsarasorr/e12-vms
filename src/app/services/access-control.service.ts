import { Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';

export interface UserDoorAccess {
    id: string;
    profile_id: string;
    door_id: string;
    is_granted: boolean;
    valid_until: string | null;
}

@Injectable({
    providedIn: 'root'
})
export class AccessControlService {

    constructor(
        private supabase: SupabaseService,
        private authService: AuthService
    ) { }

    /**
     * ดึงรายการ ID ประตูทั้งหมดที่ Profile ปัจจุบันมีสิทธิ์เข้าถึง (is_granted = true)
     * และยังไม่หมดอายุ (หรือไม่มีวันหมดอายุ)
     */
    async getAccessibleDoors(): Promise<string[]> {
        const user = await this.authService.getCurrentUser();
        const profileId = user?.id;

        if (!profileId) {
            console.warn('AccessControlService: No profile ID found. Cannot fetch door access.');
            return [];
        }

        try {
            // ดึงข้อมูลจากตาราง user_door_access
            const { data, error } = await this.supabase.client
                .from('user_door_access')
                .select('door_id')
                .eq('profile_id', profileId)
                .eq('is_granted', true);

            if (error) {
                console.error('AccessControlService: Error fetching accessible doors:', error);
                return [];
            }

            // ส่งกลับเฉพาะ array ของ door_id (string)
            return (data || []).map(row => row.door_id);

        } catch (err) {
            console.error('AccessControlService: Unexpected error:', err);
            return [];
        }
    }
}
