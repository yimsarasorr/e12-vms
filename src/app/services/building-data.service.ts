import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, from } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Asset, BuildingData } from '../data/models';
import { SupabaseService } from './supabase.service';
import { environment } from '../../environments/environment';

import fallbackBuilding from '../components/floor-plan/e12-floor1.json';

const FALLBACK_BUILDING = fallbackBuilding as unknown as BuildingData;

@Injectable({ providedIn: 'root' })
export class BuildingDataService {
  private readonly http = inject(HttpClient);
  private supabaseService = inject(SupabaseService);

  constructor() { }


  /**
   * 1. ดึงข้อมูลอาคาร (สำหรับการดูแผนผัง)
   */
  getBuilding(buildingId: string): Observable<BuildingData> {
    const request = this.supabaseService.client
      .from('buildings')
      .select(`
        id,
        name,
        role_prices,
        floors (
          id,
          name,
          level_order,
          layout_data
        )
      `)
      .eq('id', buildingId)
      .single();

    return from(request).pipe(
      map(response => {
        if (response.error || !response.data) {
          console.warn('[BuildingData] Supabase error or not found:', response.error);
          return FALLBACK_BUILDING; // Use fallback if not found in DB
        }

        const b = response.data as any;

        // Transform the DB structure to match the frontend BuildingData format
        // The DB returns floors as an array with layout_data inside
        const mappedFloors = (b.floors || []).map((f: any) => {
          const layout = f.layout_data || {};
          return {
            floor: f.level_order,
            floorName: f.name,
            walls: layout.walls || [],
            zones: layout.zones || [],
            color: layout.color || '#dfe6f3'
          };
        });

        // Sort floors by level_order
        mappedFloors.sort((a: any, b: any) => a.floor - b.floor);

        const apiBuilding: BuildingData = {
          buildingId: b.id,
          buildingName: b.name,
          floors: mappedFloors,
          role_prices: b.role_prices
        };

        return apiBuilding;
      }),
      catchError(err => {
        console.error('[BuildingData] Observable error:', err);
        return of(FALLBACK_BUILDING);
      })
    );
  }

  /**
   * 2. ดึงรายละเอียด Asset (สำหรับ Access List)
   */
  getAssetDetails(assetIds: string[]): Observable<Asset[]> {
    if (!assetIds || assetIds.length === 0) {
      return of([]);
    }

    const request = this.supabaseService.client
      .from('assets')
      .select(`
        id,
        name,
        type,
        floors ( floor_number )
      `)
      .in('id', assetIds);

    return from(request).pipe(
      map(response => {
        if (response.error) {
          console.error('Supabase Error (getAssetDetails):', response.error);
          return [];
        }

        const rows = response.data || [];
        return rows.map((item: any) => ({
          id: item.id,
          name: item.name,
          type: item.type,
          floor_number: item.floors?.floor_number || 0
        } as Asset));
      }),
      catchError(err => {
        console.error('Catch Error in getAssetDetails:', err);
        return of([]);
      })
    );
  }

  getFallback(): BuildingData {
    return FALLBACK_BUILDING;
  }
}
