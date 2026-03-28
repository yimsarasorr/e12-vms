import { Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { from, Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ParkingLot } from '../data/models'; // Import existing model

@Injectable({
  providedIn: 'root'
})
export class ParkingService {

  constructor(private supabase: SupabaseService) { }

  /**
   * Fetches buildings for a specific site using Supabase RPC.
   * @param siteId The ID of the site (e.g., '1-1')
   * @param lat User's current latitude
   * @param lng User's current longitude
   * @param userId Optional User ID for bookmark status
   */
  getSiteBuildings(siteId: string | number, lat: number = 0, lng: number = 0, profileId: string | null = null): Observable<ParkingLot[]> {
    return from((async () => {
      let lots: ParkingLot[] = [];

      // 1. Try fetching from Edge Function first.
      try {
        const response = await this.supabase.client.functions.invoke('get-parking-lots', {
          body: {
            site_id: siteId,
            lat: lat,
            lng: lng,
            user_id: profileId
          }
        });

        if (response.error) {
          throw response.error;
        }

        lots = (response.data || []) as ParkingLot[];

        if (!lots.length) {
          const { data: fallbackBuildings, error: fallbackError } = await this.supabase.client
            .from('buildings')
            .select('*')
            .eq('site_id', siteId);

          if (fallbackError) {
            throw fallbackError;
          }

          lots = (fallbackBuildings || []).map((item: any) => ({
            id: item.id,
            name: item.name,
            category: item.category || 'building',
            zone: item.zone,
            capacity: {
              normal: item.capacity_normal || 0,
              ev: item.capacity_ev || 0,
              motorcycle: item.capacity_motorcycle || 0
            },
            available: {
              normal: item.available_normal || 0,
              ev: item.available_ev || 0,
              motorcycle: item.available_motorcycle || 0
            },
            floors: item.floors || [],
            mapX: item.map_x || 0,
            mapY: item.map_y || 0,
            lat: item.lat || 0,
            lng: item.lng || 0,
            status: item.status || 'available',
            isBookmarked: false,
            distance: 0,
            hours: item.hours || '08:00 - 20:00',
            hasEVCharger: item.has_ev_charger || false,
            userTypes: item.user_types || 'General',
            price: item.price || 0,
            priceUnit: item.price_unit || 'บาท/ชม.',
            supportedTypes: item.supported_types || ['normal'],
            schedule: item.schedule || [],
            images: item.images || ['/assets/images/parking/default.png']
          }));
        }
      } catch (edgeError) {
        console.warn('[ParkingService] get-parking-lots edge function is unavailable. Falling back to public.buildings query.', edgeError);

        const { data: fallbackBuildings, error: fallbackError } = await this.supabase.client
          .from('buildings')
          .select('*')
          .eq('site_id', siteId);

        if (fallbackError) {
          throw fallbackError;
        }

        lots = (fallbackBuildings || []).map((item: any) => ({
          id: item.id,
          name: item.name,
          category: item.category || 'building',
          zone: item.zone,
          capacity: {
            normal: item.capacity_normal || 0,
            ev: item.capacity_ev || 0,
            motorcycle: item.capacity_motorcycle || 0
          },
          available: {
            normal: item.available_normal || 0,
            ev: item.available_ev || 0,
            motorcycle: item.available_motorcycle || 0
          },
          floors: item.floors || [],
          mapX: item.map_x || 0,
          mapY: item.map_y || 0,
          lat: item.lat || 0,
          lng: item.lng || 0,
          status: item.status || 'available',
          isBookmarked: false,
          distance: 0,
          hours: item.hours || '08:00 - 20:00',
          hasEVCharger: item.has_ev_charger || false,
          userTypes: item.user_types || 'General',
          price: item.price || 0,
          priceUnit: item.price_unit || 'บาท/ชม.',
          supportedTypes: item.supported_types || ['normal'],
          schedule: item.schedule || [],
          images: item.images || ['assets/images/parking/default.png']
        }));
      }

      // 2. Client-Side Price Override (Bypass Edge Function RLS Issue)
      // Since Edge Function runs as ANON and RLS blocks profile fetching, 
      // we fetch the profile here using the Client's valid Auth Token, then override the prices.
      if (profileId) {
        try {
          const { data: profile } = await this.supabase.client
            .from('profiles')
            .select('role')
            .eq('id', profileId)
            .single();

          if (profile && profile.role) {
            const roleStr = String(profile.role).toLowerCase();

            lots = lots.map(lot => {
              const roleKeyMap: { [key: string]: string } = {
                'user': 'User',
                'host': 'Host',
                'visitor': 'Visitor'
              };
              const exactRoleKey = roleKeyMap[roleStr] || 'Visitor';
              
              // If Edge Function forwarded the role_prices JSON, use it, else keep original lot.price
              const rolePrices = (lot as any).role_prices;
              if (rolePrices && rolePrices[exactRoleKey] !== undefined) {
                 lot.price = rolePrices[exactRoleKey];
              }

              if (lot.price === 0) {
                 lot.priceUnit = 'จอดฟรี';
              } else {
                 lot.priceUnit = 'บาท/ชม.';
              }
              return lot;
            });
          }
        } catch (e) {
          console.error('Failed to override price client-side', e);
        }
      }

      return lots;
    })()).pipe(
      catchError(err => {
        console.error('Available Edge Function Call Failed:', err);
        return of([]);
      })
    );
  }

  /**
   * Fetches availability for a building within a specific time range.
   */
  getAvailability(buildingId: string, startTime: Date, endTime: Date, vehicleType: string = 'car'): Observable<any[]> {
    const rpcName = 'get_building_availability';
    const params = {
      p_building_id: buildingId,
      p_start_time: startTime.toISOString(),
      p_end_time: endTime.toISOString(),
      p_vehicle_type: vehicleType
    };

    return from(
      this.supabase.client.rpc(rpcName, params)
    ).pipe(
      map(response => {
        if (response.error) throw response.error;
        return response.data || []; // Return raw data (Floor/Zone structure)
      }),
      catchError(err => {
        console.error('Availability RPC Call Failed:', err);
        return of([]);
      })
    );
  }

  /**
   * Fetches time slot availability for a building.
   */
  getBuildingTimeSlots(
    buildingId: string,
    startTime: Date,
    endTime: Date,
    intervalMinutes: number = 60,
    vehicleType: string = 'car',
    durationMinutes: number | null = null // New Argument
  ): Observable<any[]> {
    const rpcName = 'get_building_slots_availability';
    const params = {
      p_building_id: buildingId,
      p_start_time: startTime.toISOString(),
      p_end_time: endTime.toISOString(),
      p_interval_minutes: intervalMinutes,
      p_vehicle_type: vehicleType,
      p_duration_minutes: durationMinutes
    };

    console.log(`[ParkingService] Calling RPC: ${rpcName}`, params);

    return from(
      this.supabase.client.rpc(rpcName, params)
    ).pipe(
      map(response => {
        if (response.error) {
          console.error(`[ParkingService] RPC Error:`, response.error);
          throw response.error;
        }
        console.log(`[ParkingService] RPC Success. Data length:`, response.data?.length);
        return response.data || [];
      }),
      catchError(err => {
        console.error('Time Slots RPC Call Failed:', err);
        return of([]);
      })
    );
  }

  /**
   * Finds the best available slot ID in a given zone and time range.
   */
  findBestAvailableSlot(zoneId: string, startTime: Date, endTime: Date): Observable<any> {
    const rpcName = 'find_best_available_slot';
    const params = {
      p_zone_id: zoneId,
      p_start_time: startTime.toISOString(),
      p_end_time: endTime.toISOString()
    };

    return from(
      this.supabase.client.rpc(rpcName, params)
    ).pipe(
      map(response => {
        if (response.error) throw response.error;
        return response.data; // { slot_id: '...', slot_name: '...' } or null
      }),
      catchError(err => {
        console.error('Find Slot RPC Call Failed:', err);
        return of(null);
      })
    );
  }
  get supabaseClient() {
    return this.supabase.client;
  }
}
