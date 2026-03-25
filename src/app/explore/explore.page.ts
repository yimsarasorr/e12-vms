import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  AfterViewInit,
  Inject,
  PLATFORM_ID,
  NgZone
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalController, Platform, AlertController } from '@ionic/angular';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { Subscription, interval, of, Subject } from 'rxjs';
import { catchError, timeout, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { UiEventService } from '../services/ui-event';
import { SupabaseService } from '../services/supabase.service';
import { BuildingDetailComponent } from '../modal/building-detail/building-detail.component';
import { RegisterCodeModalComponent } from '../modal/register-code/register-code-modal.component';

import * as ngeohash from 'ngeohash';
import { ParkingLot, ScheduleItem, UserProfile } from '../data/models';
import { ParkingDataService } from '../services/parking-data.service';
import { ParkingService } from '../services/parking.service';
import { BookmarkService } from '../services/bookmark.service';
import { BottomSheetService } from '../services/bottom-sheet.service';

@Component({
  selector: 'app-explore',
  templateUrl: 'explore.page.html',
  styleUrls: ['explore.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule],
})
export class ExplorePage implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('sheetContent') sheetContentEl!: ElementRef<HTMLElement>;

  searchQuery = '';
  selectedTab = 'all';
  selectedLocation: 'building' = 'building';

  allParkingLots: ParkingLot[] = [];
  visibleParkingLots: ParkingLot[] = [];
  filteredParkingLots: ParkingLot[] = [];

  userProfile: UserProfile | null = null;

  // --- User Coordinates (Default) ---
  userLat = 0;
  userLon = 0;

  // --- Map Variables ---
  private map: any;
  private markers: any[] = [];
  private userMarker: any;
  private geoHashBounds: any; // เลเยอร์กรอบสี่เหลี่ยม Geohash
  private userGeoHash: string | null = null;
  private mapCenteredByUserLocation = false;
  private lastLocationErrorCode: number | null = null;

  // --- Subscription & Animation ---
  private animationFrameId: any;
  private sheetToggleSub!: Subscription;
  private timeCheckSub!: Subscription;
  private searchSub!: Subscription;

  // --- Search Subject ---
  private searchSubject = new Subject<string>();
  isSearching = false;

  // --- Bottom Sheet Config ---
  sheetLevel = 1; // 0 = minimized, 1 = mid, 2 = full
  currentSheetHeight = 250;
  isDragging = false;
  isSnapping = true;
  startY = 0;
  startHeight = 0;
  startLevel = 1;
  canScroll = false;

  // Velocity tracking
  lastY = 0;
  lastTime = 0;
  velocityY = 0;

  isModalOpen = false;

  constructor(
    private modalCtrl: ModalController,
    private uiEventService: UiEventService,
    private platform: Platform,
    private alertCtrl: AlertController, // ✅ Inject AlertController
    private parkingDataService: ParkingDataService, // Renamed for clarity
    private parkingApiService: ParkingService, // Inject new RPC Service
    private supabaseService: SupabaseService, // Inject Supabase for Realtime
    private router: Router, // ✅ Inject Router
    private bottomSheetService: BottomSheetService,
    private bookmarkService: BookmarkService, // ✅ Inject Bookmark Service
    @Inject(PLATFORM_ID) private platformId: Object,
    private ngZone: NgZone // Inject NgZone for performance optimization
  ) { }


  ngOnInit() {
    this.updateSheetHeightByLevel(this.sheetLevel);

    // Load building list immediately; do not wait for auth/profile id.
    this.loadRealData();

    this.sheetToggleSub = this.uiEventService.toggleExploreSheet$.subscribe(() => {
      requestAnimationFrame(() => {
        this.toggleSheetState();
      });
    });

    // 1. Subscribe to User Profile first
    this.parkingDataService.userProfile$.subscribe(p => {
      this.userProfile = p;
    });

    // Subscribe to Refresh Event
    this.uiEventService.refreshParkingData$.subscribe(() => {
      console.log('[Tab1] 🔄 Refresh Event Received. Reloading Data...');
      this.loadRealData();
    });

    this.timeCheckSub = interval(60000).subscribe(() => {
      this.updateParkingStatuses();
    });

    // Start Realtime Subscription
    this.setupRealtimeSubscription();

    // Setup Search Debounce
    this.searchSub = this.searchSubject.pipe(
      debounceTime(400)
    ).subscribe(() => {
      this.filterData();
      this.isSearching = false;
    });


  }

  setupRealtimeSubscription() {
    console.log('[Tab1] 🔴 Starting Realtime Subscription...');

    const channel = this.supabaseService.client.channel('building-channel');

    channel
      .on('postgres_changes', { event: '*', schema: 'public', table: 'buildings' }, (payload) => {
        console.log('[Tab1] 🔔 Realtime Building Update:', payload);
        this.handleRealtimeUpdate();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Tab1] ✅ Realtime Connection Established (buildings)');
        }
      });
  }

  handleRealtimeUpdate() {
    // Add a small delay/debounce to allow DB triggers to finish computing
    setTimeout(() => {
      console.log('[Tab1] 🔄 Refreshing Data due to Realtime Event...');
      this.loadRealData();
    }, 1000); // 1s delay for safety
  }

  loadRealData() {
    console.log('[Tab1] 1. Requesting Real Data API...');
    const profileId = this.userProfile?.id || null;
    this.parkingApiService.getSiteBuildings(1, this.userLat, this.userLon, profileId)
      .pipe(
        timeout(3000),
        catchError(err => {
          console.error('[Tab1] API Error or Timeout.', err);
          return of([]);
        })
      )
      .subscribe({
        next: async (realLots) => {
          if (realLots) {
            const buildingLots = realLots.filter((lot) => String(lot.category || 'building').toLowerCase() === 'building');
            console.log('[Tab1] Applying Building Data (Count: ' + buildingLots.length + ')');

            // Fetch bookmarks and apply to lots
            const bookmarkedIds = await this.bookmarkService.getBookmarkedBuildingIds();
            buildingLots.forEach(lot => {
              lot.isBookmarked = bookmarkedIds.includes(lot.id);
            });

            this.allParkingLots = buildingLots;

            // If location permission is unavailable, center map by E12 (from DB) or first building with coordinates.
            if (!this.mapCenteredByUserLocation) {
              const e12Building = this.allParkingLots.find((lot) => lot.id === 'E12' && !!lot.lat && !!lot.lng);
              const fallbackBuilding = e12Building || this.allParkingLots.find((lot) => !!lot.lat && !!lot.lng);
              if (fallbackBuilding?.lat && fallbackBuilding?.lng) {
                this.userLat = Number(fallbackBuilding.lat);
                this.userLon = Number(fallbackBuilding.lng);
                if (this.map) {
                  this.map.setView([this.userLat, this.userLon], 16);
                }
              }
            }

            this.processScheduleData();
            this.updateParkingStatuses();
            this.calculateDistances(); // Calculate distance & color here
            this.filterData();

            if (this.filteredParkingLots.length === 0) {
              console.warn('[Tab1] ⚠️ View is empty after API update.');
            }

          } else {
            console.warn('[Tab1] ⚠️ API returned empty/error.');
            this.allParkingLots = [];
            this.filterData();
          }
        },
        error: (err) => {
          console.error('[Tab1] Subscribe Error:', err);
          this.allParkingLots = [];
          this.filterData();
        }
      });
  }

  filterData() {
    let results = this.allParkingLots;

    results = results.filter(lot => String(lot.category || 'building').toLowerCase() === 'building');

    if (this.searchQuery.trim() !== '') {
      const q = this.searchQuery.toLowerCase();
      results = results.filter((lot) => String(lot.name || '').toLowerCase().includes(q));
    }

    this.filteredParkingLots = results;
    this.visibleParkingLots = results;

    this.updateParkingStatuses();
    this.updateMarkers(); // Update Map
  }

  onSearch() {
    this.isSearching = true;
    this.searchSubject.next(this.searchQuery);
  }

  async openRegisterCodeModal() {
    const modal = await this.modalCtrl.create({
      component: RegisterCodeModalComponent,
      breakpoints: [0, 0.75],
      initialBreakpoint: 0.75,
    });
    await modal.present();

    const { data, role } = await modal.onDidDismiss();
    if (role === 'confirm' && data) {
      let accessData: any = null;

      try {
        const { data: ticketData, error } = await this.supabaseService.client
          .from('access_tickets')
          .select('building_id, floor, room_id')
          .eq('invite_code', data.code)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) throw error;
        accessData = ticketData;
      } catch (err) {
        console.error('Failed to fetch access ticket detail:', err);
      }

      const buildingId = accessData?.building_id || 'E12';

      this.router.navigate(['/building-access'], {
        queryParams: { buildingId }
      });

      setTimeout(() => {
        this.bottomSheetService.open(
          'access-list',
          undefined,
          'สิทธิ์เข้าอาคารของคุณ',
          'peek'
        );
      }, 400);
    }
  }

  //  ทำงานหลังจากหน้าเว็บโหลดเสร็จ (เพื่อโหลด Map)
  async ngAfterViewInit() {
    if (isPlatformBrowser(this.platformId)) {
      await this.initMap();
      // Auto-request user location at startup so distance and marker are ready without tapping locate.
      this.focusOnUser(true);
      this.loadRealData();
      this.updateMarkers();
    }
  }

  ngOnDestroy() {
    if (this.sheetToggleSub) this.sheetToggleSub.unsubscribe();
    if (this.timeCheckSub) this.timeCheckSub.unsubscribe();
    if (this.searchSub) this.searchSub.unsubscribe();
    if (this.map) {
      this.map.remove();
    }
  }

  // ----------------------------------------------------------------
  //  MAP LOGIC (Leaflet + Geohash + Error Handling)
  // ----------------------------------------------------------------

  private requestCurrentPosition(options: PositionOptions): Promise<{ lat: number; lng: number } | null> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.lastLocationErrorCode = null;
          resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        (err) => {
          this.lastLocationErrorCode = err?.code ?? null;
          resolve(null);
        },
        options
      );
    });
  }

  private async getCurrentPositionWithFallback(): Promise<{ lat: number; lng: number } | null> {
    // Try a quick cached/low-accuracy location first to avoid first-request timeout.
    const quickPosition = await this.requestCurrentPosition({
      enableHighAccuracy: false,
      timeout: 5000,
      maximumAge: 300000,
    });
    if (quickPosition) return quickPosition;

    // Then try precise GPS fix.
    const precisePosition = await this.requestCurrentPosition({
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 0,
    });
    if (precisePosition) return precisePosition;

    // Final retry with relaxed options (common fix for first-call timeout).
    return this.requestCurrentPosition({
      enableHighAccuracy: false,
      timeout: 12000,
      maximumAge: 600000,
    });
  }

  private async renderUserLocationOnMap(lat: number, lng: number, moveMap: boolean = false) {
    if (!this.map) return;

    const L = await import('leaflet');

    if (moveMap) {
      this.map.flyTo([lat, lng], 17);
    }

    if (!this.userMarker) {
      const userIcon = L.divIcon({
        html: `<div style="width: 15px; height: 15px; background: #4285F4; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 5px rgba(0,0,0,0.3);"></div>`,
        className: '',
        iconSize: [15, 15]
      });
      this.userMarker = L.marker([lat, lng], { icon: userIcon }).addTo(this.map);
    } else {
      this.userMarker.setLatLng([lat, lng]);
    }

    this.userGeoHash = ngeohash.encode(lat, lng, 7);

    if (this.geoHashBounds) {
      this.map.removeLayer(this.geoHashBounds);
    }

    const boundsArray = ngeohash.decode_bbox(this.userGeoHash);
    const bounds = [[boundsArray[0], boundsArray[1]], [boundsArray[2], boundsArray[3]]];

    // @ts-ignore
    this.geoHashBounds = L.rectangle(bounds, {
      color: '#4285f4',
      weight: 1,
      fillOpacity: 0.1,
      fillColor: '#4285f4'
    }).addTo(this.map);
  }

  private async getE12CenterFromDatabase(): Promise<{ lat: number; lng: number } | null> {
    try {
      const { data, error } = await this.supabaseService.client
        .from('buildings')
        .select('lat,lng')
        .eq('id', 'E12')
        .maybeSingle();

      if (error || !data?.lat || !data?.lng) {
        return null;
      }

      return { lat: Number(data.lat), lng: Number(data.lng) };
    } catch {
      return null;
    }
  }

  private async initMap() {
    const L = await import('leaflet');

    // ตั้งค่า Default Icon
    const iconUrl = 'assets/icon/favicon.png';
    const DefaultIcon = L.Icon.extend({
      options: {
        iconUrl,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        popupAnchor: [0, -15],
      }
    });
    L.Marker.prototype.options.icon = new DefaultIcon();

    // Center map by user location when allowed; otherwise use E12 coordinates from DB.
    const userPosition = await this.getCurrentPositionWithFallback();
    const dbFallback = userPosition ? null : await this.getE12CenterFromDatabase();

    const centerLat = userPosition?.lat ?? dbFallback?.lat ?? 0;
    const centerLng = userPosition?.lng ?? dbFallback?.lng ?? 0;

    this.userLat = centerLat;
    this.userLon = centerLng;
    this.mapCenteredByUserLocation = !!userPosition;

    this.map = L.map('map', {
      center: [centerLat, centerLng],
      zoom: 16,
      zoomControl: false,
      attributionControl: false,
      fadeAnimation: false,
      zoomAnimation: false,
      markerZoomAnimation: false
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      updateWhenIdle: true,
      keepBuffer: 8
    }).addTo(this.map);

    if (userPosition) {
      await this.renderUserLocationOnMap(userPosition.lat, userPosition.lng, false);
    }

    setTimeout(() => { this.map.invalidateSize(); }, 500);
  }

  private createPinIcon(L: any, color: string, text: string = '') {
    const svgContent = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" stroke="white" stroke-width="1.5" width="40px" height="40px">
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
        <text x="12" y="11.5" font-family="Arial, sans-serif" font-weight="bold" font-size="7" fill="white" stroke="none" text-anchor="middle">${text}</text>
      </svg>
    `;

    return L.divIcon({
      html: svgContent,
      className: '',
      iconSize: [40, 40],
      iconAnchor: [20, 40],
      popupAnchor: [0, -40]
    });
  }

  async updateMarkers() {
    if (!this.map) return;
    const L = await import('leaflet');

    // ลบ Marker เก่า
    this.markers.forEach(m => this.map.removeLayer(m));
    this.markers = [];

    // วาด Marker ใหม่
    this.visibleParkingLots.forEach((lot, index) => {
      if (lot.lat && lot.lng) {
        // ใช้ border line color (distanceColor) หรือสีตั้งต้นถ้าไม่มีจาก API (lot.distanceColor ไม่ควรเป็นว่างถ้าคำนวณผ่าน calculateDistances())
        const color = lot.distanceColor || '#6c757d';

        // ลำดับ (Index + 1)
        const rankNumber = (index + 1).toString();

        const icon = this.createPinIcon(L, color, rankNumber);

        const marker = L.marker([lot.lat, lot.lng], { icon: icon })
          .addTo(this.map)
          .bindPopup(`<b>${lot.name}</b><br>ว่าง: ${this.getDisplayAvailable(lot)} คัน`);

        marker.on('click', () => {
          this.viewLotDetails(lot);
        });

        this.markers.push(marker);
      }
    });
  }

  // ✅ ฟังก์ชันหาตำแหน่ง + Geohash + Error Alert
  public focusOnUser(silent: boolean = false) {
    if (!navigator.geolocation) {
      if (!silent) {
        this.showLocationError('เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง');
      }
      return;
    }

    this.getCurrentPositionWithFallback().then(async (position) => {
      if (position) {
        const lat = position.lat;
        const lng = position.lng;

        this.userLat = lat;
        this.userLon = lng;
        this.mapCenteredByUserLocation = true;

        this.calculateDistances();
        this.filterData();
        await this.renderUserLocationOnMap(lat, lng, true);
        return;
      }

      //  จัดการ Error ที่นี่ (กรณี User กด Block หรือ GPS ไม่ทำงาน)
      console.error('Error getting location', this.lastLocationErrorCode);

      let message = 'ไม่สามารถระบุตำแหน่งได้';
      if (this.lastLocationErrorCode === 1) { // PERMISSION_DENIED
        message = 'กรุณาเปิดสิทธิ์การเข้าถึงตำแหน่ง (Location Permission) ที่การตั้งค่าของเบราว์เซอร์หรืออุปกรณ์';
      } else if (this.lastLocationErrorCode === 2) { // POSITION_UNAVAILABLE
        message = 'สัญญาณ GPS ขัดข้อง ไม่สามารถระบุตำแหน่งได้';
      } else if (this.lastLocationErrorCode === 3) { // TIMEOUT
        message = 'หมดเวลาในการค้นหาตำแหน่ง ลองใหม่อีกครั้ง';
      }

      if (!silent) {
        this.showLocationError(message);
      }
    });
  }

  //  ฟังก์ชันแสดง Alert
  async showLocationError(msg: string) {
    const alert = await this.alertCtrl.create({
      header: 'แจ้งเตือนพิกัด',
      message: msg,
      buttons: ['ตกลง'],
      mode: 'ios'
    });
    await alert.present();
  }

  // ----------------------------------------------------------------
  //  LOGIC การ Filter และ Bottom Sheet 
  // ----------------------------------------------------------------



  // Drag & Drop
  getPixelHeightForLevel(level: number): number {
    const platformHeight = this.platform.height();
    if (level === 0) return 80;
    if (level === 1) return platformHeight * 0.35;
    if (level === 2) return platformHeight * 0.85;
    return 80;
  }

  updateSheetHeightByLevel(level: number) {
    this.currentSheetHeight = this.getPixelHeightForLevel(level);
    this.canScroll = level === 2;
    if (level === 0 && this.sheetContentEl?.nativeElement) {
      this.sheetContentEl.nativeElement.scrollTop = 0;
    }
  }

  startDrag(ev: any) {
    const touch = ev.touches ? ev.touches[0] : ev;
    this.startY = touch.clientY;

    // Reset velocity trackers
    this.lastY = this.startY;
    this.lastTime = Date.now();
    this.velocityY = 0;

    const sheet = document.querySelector('.bottom-sheet') as HTMLElement;
    sheet.classList.remove('snapping');
    this.isSnapping = false;
    this.startHeight = sheet.offsetHeight;
    this.startLevel = this.sheetLevel;
    this.isDragging = false;

    // Run outside Angular zone to prevent Change Detection on every pixel move
    this.ngZone.runOutsideAngular(() => {
      window.addEventListener('mousemove', this.dragMove);
      window.addEventListener('mouseup', this.endDrag);
      window.addEventListener('touchmove', this.dragMove, { passive: false });
      window.addEventListener('touchend', this.endDrag);
    });
  }

  dragMove = (ev: any) => {
    const touch = ev.touches ? ev.touches[0] : ev;
    const currentY = touch.clientY;
    const now = Date.now();

    // Calculate instantaneous velocity (pixels per ms)
    if (this.lastTime > 0) {
      const dt = now - this.lastTime;
      const dy = currentY - this.lastY;
      if (dt > 0) {
        // Exponential moving average for smooth velocity
        this.velocityY = (this.velocityY * 0.4) + ((dy / dt) * 0.6);
      }
    }
    this.lastY = currentY;
    this.lastTime = now;

    const contentEl = this.sheetContentEl.nativeElement;
    const isAtTop = contentEl.scrollTop <= 0;
    const isMaxLevel = this.sheetLevel === 2;

    if (isMaxLevel && !isAtTop) {
      this.startY = currentY;
      this.startHeight = this.getPixelHeightForLevel(2);
      return;
    }

    const diff = this.startY - currentY;
    if (!this.isDragging && Math.abs(diff) < 5) return;

    if (!isMaxLevel || (isMaxLevel && isAtTop && diff < 0)) {
      if (ev.cancelable) ev.preventDefault();
      this.isDragging = true;
      let newHeight = this.startHeight + diff;
      const maxHeight = this.platform.height() - 40;
      newHeight = Math.max(80, Math.min(newHeight, maxHeight));
      if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = requestAnimationFrame(() => {
        const sheet = document.querySelector('.bottom-sheet') as HTMLElement;
        if (sheet) {
          sheet.style.height = `${newHeight}px`;
        }
      });
    }
  };

  endDrag = (ev: any) => {
    window.removeEventListener('mousemove', this.dragMove);
    window.removeEventListener('mouseup', this.endDrag);
    window.removeEventListener('touchmove', this.dragMove);
    window.removeEventListener('touchend', this.endDrag);
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // Jump back into Angular zone to apply final state
    this.ngZone.run(() => {
      if (this.isDragging) {
        const sheet = document.querySelector('.bottom-sheet') as HTMLElement;
        const finalH = sheet.offsetHeight;
        const totalDragged = finalH - this.startHeight;
        const platformHeight = this.platform.height();
        const dragThreshold = platformHeight * 0.05; // Very responsive pull (5% height)

        const h0 = this.getPixelHeightForLevel(0);
        const h1 = this.getPixelHeightForLevel(1);
        const h2 = this.getPixelHeightForLevel(2);

        // Detect flick gesture (Ionic modal characteristic)
        const isFlickUp = this.velocityY < -0.6; // SWIPE UP = negative velocity (pixels moving up)
        const isFlickDown = this.velocityY > 0.6; // SWIPE DOWN = positive velocity

        if (isFlickUp) {
          // Flicked Up -> go to next higher level
          if (this.startLevel === 0) this.sheetLevel = 1;
          else if (this.startLevel === 1) this.sheetLevel = 2;
        } else if (isFlickDown) {
          // Flicked Down -> go to next lower level
          if (this.startLevel === 2) this.sheetLevel = 1;
          else if (this.startLevel === 1) this.sheetLevel = 0;
        } else {
          // Distance based fallback if swiped slowly
          if (totalDragged > dragThreshold) {
            // Dragged UP: Snaps up
            if (this.startLevel === 0) {
              this.sheetLevel = (finalH > h1 + dragThreshold) ? 2 : 1;
            } else if (this.startLevel === 1) {
              this.sheetLevel = 2;
            }
          } else if (totalDragged < -dragThreshold) {
            // Dragged DOWN: Snaps down
            if (this.startLevel === 2) {
              this.sheetLevel = (finalH < h1 - dragThreshold) ? 0 : 1;
            } else if (this.startLevel === 1) {
              this.sheetLevel = 0;
            }
          } else {
            // Didn't drag enough, revert to start level
            this.sheetLevel = this.startLevel;
          }
        }

        this.snapToCurrentLevel();
      } else {
        this.snapToCurrentLevel();
      }
      setTimeout(() => { this.isDragging = false; }, 100);
    });
  };

  snapToCurrentLevel() {
    this.isSnapping = true;
    this.updateSheetHeightByLevel(this.sheetLevel);

    // Explicitly set DOM height to override manual drag styles since Angular change detection might skip
    // if `currentSheetHeight` hasn't mathematically changed but the DOM was manipulated during drag.
    const sheet = document.querySelector('.bottom-sheet') as HTMLElement;
    if (sheet) {
      sheet.classList.add('snapping');
      sheet.style.height = `${this.currentSheetHeight}px`;
    }
  }

  toggleSheetState() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.isDragging = false;
    const sheet = document.querySelector('.bottom-sheet') as HTMLElement;
    if (sheet) {
      sheet.classList.remove('snapping');
      void sheet.offsetWidth;
      sheet.classList.add('snapping');
      this.isSnapping = true;
    }
    if (this.sheetLevel === 0) {
      this.sheetLevel = 1;
    } else {
      this.sheetLevel = 0;
    }
    this.updateSheetHeightByLevel(this.sheetLevel);
  }

  // Helper Functions
  processScheduleData() {
    this.allParkingLots.forEach(lot => {
      if (lot.schedule && lot.schedule.length > 0) {
        lot.schedule.forEach(sch => this.parseCronToScheduleData(sch));
      }
    });
  }

  updateParkingStatuses() {
    const now = new Date();
    this.allParkingLots.forEach((lot) => {
      if (!lot.schedule || lot.schedule.length === 0) {
        lot.hours = 'เปิด 24 ชั่วโมง';
        return;
      }
      let isOpenNow = false;
      let displayTexts: string[] = [];
      lot.schedule.forEach((sch) => {
        const isActive = this.checkIsScheduleActive(sch, now);
        if (isActive) isOpenNow = true;
        const dayText = this.formatDaysText(sch.days);
        displayTexts.push(`${dayText} ${sch.open_time} - ${sch.close_time}`);
      });
      const hoursText = displayTexts.join(', ');

      const currentAvailable = this.getDisplayAvailable(lot);

      if (!isOpenNow) {
        lot.status = 'closed';
        lot.hours = `ปิด (${hoursText})`;
      } else {
        lot.hours = `เปิดอยู่ (${hoursText})`;
        const totalCap = this.getDisplayCapacity(lot);

        if (currentAvailable <= 0) lot.status = 'full';
        else if (totalCap > 0 && (currentAvailable / totalCap) < 0.1) lot.status = 'low';
        else lot.status = 'available';
      }
    });
  }

  parseCronToScheduleData(sch: ScheduleItem) {
    const openParts = sch.cron.open.split(' ');
    const closeParts = sch.cron.close.split(' ');
    if (openParts.length >= 5 && closeParts.length >= 5) {
      sch.open_time = `${this.pad(openParts[1])}:${this.pad(openParts[0])}`;
      sch.close_time = `${this.pad(closeParts[1])}:${this.pad(closeParts[0])}`;
      sch.days = this.parseCronDays(openParts[4]);
    }
  }

  parseCronDays(dayPart: string): string[] {
    const dayMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const daysIndex: number[] = [];
    if (dayPart === '*') return [...dayMap];
    if (dayPart.includes('-')) {
      const [start, end] = dayPart.split('-').map(Number);
      let current = start;
      let loopCount = 0;
      while (current !== end && loopCount < 8) {
        daysIndex.push(current % 7);
        current = (current + 1) % 7;
        loopCount++;
      }
      daysIndex.push(end % 7);
    } else if (dayPart.includes(',')) {
      dayPart.split(',').forEach((d) => daysIndex.push(Number(d) % 7));
    } else {
      daysIndex.push(Number(dayPart) % 7);
    }
    return [...new Set(daysIndex.map((i) => dayMap[i]))];
  }

  checkIsScheduleActive(sch: ScheduleItem, now: Date): boolean {
    const dayMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const currentDayName = dayMap[now.getDay()];
    if (!sch.days.includes(currentDayName)) return false;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const [openH, openM] = sch.open_time.split(':').map(Number);
    const startMinutes = openH * 60 + openM;
    const [closeH, closeM] = sch.close_time.split(':').map(Number);
    let endMinutes = closeH * 60 + closeM;
    if (endMinutes < startMinutes) endMinutes += 24 * 60;
    return nowMinutes >= startMinutes && nowMinutes <= endMinutes;
  }

  pad(val: string | number): string {
    return val.toString().padStart(2, '0');
  }

  formatDaysText(days: string[]): string {
    const thaiDays: { [key: string]: string } = {
      sunday: 'อา.', monday: 'จ.', tuesday: 'อ.', wednesday: 'พ.',
      thursday: 'พฤ.', friday: 'ศ.', saturday: 'ส.'
    };
    if (days.length === 7) return 'ทุกวัน';
    return days.map(d => thaiDays[d]).join(',');
  }

  getTypeName(type: string): string {
    switch (type) {
      case 'normal': return 'Car';
      case 'ev': return 'EV';
      case 'motorcycle': return 'Motorcycle';
      default: return type;
    }
  }

  getSupportedTypesText(types: string[]): string {
    if (!types || types.length === 0) return '-';
    const names = types.map(t => {
      if (t === 'normal') return 'รถยนต์ทั่วไป';
      if (t === 'ev') return 'รถ EV';
      if (t === 'motorcycle') return 'รถจักรยานยนต์';
      return t;
    });
    return names.join(', ');
  }

  // --- Distance Calculations ---
  calculateDistances() {
    this.allParkingLots.forEach(lot => {
      // Use lot.lat and lot.lng if available, otherwise default to mapX/mapY if they hold coordinates
      const lotLat = lot.lat || lot.mapX;
      const lotLng = lot.lng || lot.mapY;

      if (lotLat && lotLng) {
        // Calculate distance in km
        const distKm = this.calculateDistance(this.userLat, this.userLon, lotLat, lotLng);
        // Distance converted to meters
        lot.distance = Math.round(distKm * 1000);
      } else {
        lot.distance = 999999;
      }
    });

    // Sort lots by calculated distance
    this.allParkingLots.sort((a, b) => (a.distance || 0) - (b.distance || 0));

    // Assign gradient color based on sorted rank (Blue to Gray)
    const validLots = this.allParkingLots.filter(l => l.distance !== 999999);
    const totalValid = validLots.length;

    this.allParkingLots.forEach((lot, index) => {
      if (lot.distance === 999999) {
        lot.distanceColor = 'hsl(214, 0%, 75%)'; // default gray
      } else {
        // Calculate transition from Primary Blue (hsl(214, 82%, 51%)) to Gray (hsl(214, 0%, 75%))
        const ratio = totalValid > 1 ? index / (totalValid - 1) : 0;

        // Saturation fades from 82% to 0% (Gray)
        const saturation = Math.floor(82 - (ratio * 82));

        // Lightness shifts from 51% (Blue) to 75% (Light Gray)
        const lightness = Math.floor(51 + (ratio * 24));

        lot.distanceColor = `hsl(214, ${saturation}%, ${lightness}%)`;
      }
    });
  }

  calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Radius of the earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  async toggleBookmark(lot: ParkingLot, event: Event) {
    event.stopPropagation();
    if (!lot?.id) return;

    try {
      if (lot.isBookmarked) {
        await this.bookmarkService.removeBookmark(lot.id);
        lot.isBookmarked = false;
      } else {
        await this.bookmarkService.addBookmark(lot.id);
        lot.isBookmarked = true;
      }
    } catch (e) {
      console.error('Error toggling bookmark', e);
    }
  }

  async viewLotDetails(lot: ParkingLot) {
    const modal = await this.modalCtrl.create({
      component: BuildingDetailComponent,
      componentProps: {
        lot: lot
      },
      initialBreakpoint: 1,
      breakpoints: [0, 1],
      backdropDismiss: true,
      showBackdrop: true,
      cssClass: 'detail-sheet-modal',
    });
    await modal.present();
  }

  getMarkerColor(available: number | null, capacity: number) {
    if (available === null || available === 0) return 'danger';
    if (available / capacity < 0.3) return 'warning';
    return 'success';
  }
  getStatusColor(status: string) {
    switch (status) {
      case 'available': return 'success';
      case 'low': return 'warning';
      case 'full': case 'closed': return 'danger';
      default: return 'medium';
    }
  }
  getStatusText(status: string) {
    switch (status) {
      case 'available': return 'ว่าง';
      case 'low': return 'ใกล้เต็ม';
      case 'full': return 'เต็ม';
      case 'closed': return 'ปิด';
      default: return 'N/A';
    }
  }

  getDisplayCapacity(lot: ParkingLot): number {
    if (!lot.capacity) return 0;
    if (this.selectedTab === 'all') {
      return (lot.capacity.normal || 0) + (lot.capacity.ev || 0) + (lot.capacity.motorcycle || 0);
    }
    // @ts-ignore
    return lot.capacity[this.selectedTab] || 0;
  }

  getDisplayAvailable(lot: ParkingLot): number {
    if (!lot.available) return 0;
    if (this.selectedTab === 'all') {
      return (lot.available.normal || 0) + (lot.available.ev || 0) + (lot.available.motorcycle || 0);
    }
    // @ts-ignore
    return lot.available[this.selectedTab] || 0;
  }

  //  Mock Data พร้อมพิกัด (lat, lng)
  // getMockData(): ParkingLot[] {
  //   return TAB1_PARKING_LOTS;
  // }
}