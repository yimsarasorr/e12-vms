import {
  Booking,
  ParkingLot,
  SettingItem,
  UserProfile,
  Vehicle,
} from './models';

// =======================================================
// MOCK DATA FOR TAB 1 (Parking List & Map)
// =======================================================

export const TAB1_PARKING_LOTS: ParkingLot[] = [
  {
    id: "1-1",
    lat: 13.655,
    lng: 100.496,
    mapX: 0,
    mapY: 0,
    name: "ลานจอดรถ FIBO",
    category: 'parking',
    hours: "เปิด 08:00 - 20:00",
    price: 0,
    floors: [
      {
        id: "1-1-1",
        name: "ชั้น 1"
      }
    ],
    images: [
      "https://fibo.kmutt.ac.th/wp-content/uploads/2025/10/FIBOBLDG-scaled.jpg",
      "https://static.wixstatic.com/media/9821cb_7e40f0d6089c40ca86bea5bed1b1fa51.jpg/v1/fill/w_560,h_428,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/9821cb_7e40f0d6089c40ca86bea5bed1b1fa51.jpg"
    ],
    status: "available",
    capacity: {
      ev: 0,
      normal: 205,
      motorcycle: 0
    },
    distance: 0,
    schedule: [
      {
        cron: {
          open: "0 8 * * *",
          close: "0 20 * * *"
        },
        days: [],
        open_time: "08:00",
        "close_time": "20:00"
      }
    ],
    available: {
      ev: 0,
      normal: 205,
      motorcycle: 0
    },
    priceUnit: "ฟรี",
    userTypes: "นศ., บุคลากร",
    hasEVCharger: false,
    isBookmarked: false,
    supportedTypes: [
      "normal"
    ]
  },
  {
    id: "1-2",
    lat: 13.6515,
    lng: 100.4945,
    mapX: 0,
    mapY: 0,
    name: "อาคารจอดรถ 14 ชั้น (S2)",
    category: 'parking',
    hours: "เปิด 08:00 - 20:00",
    price: 0,
    floors: [
      {
        id: "1-2-1",
        name: "ชั้น 1"
      },
      {
        id: "1-2-10",
        name: "ชั้น 10"
      },
      {
        id: "1-2-11",
        name: "ชั้น 11"
      },
      {
        id: "1-2-12",
        name: "ชั้น 12"
      },
      {
        id: "1-2-13",
        name: "ชั้น 13"
      },
      {
        id: "1-2-14",
        name: "ชั้น 14"
      },
      {
        id: "1-2-2",
        name: "ชั้น 2"
      },
      {
        id: "1-2-3",
        name: "ชั้น 3"
      },
      {
        id: "1-2-4",
        "name": "ชั้น 4"
      },
      {
        id: "1-2-5",
        "name": "ชั้น 5"
      },
      {
        id: "1-2-6",
        "name": "ชั้น 6"
      },
      {
        id: "1-2-7",
        "name": "ชั้น 7"
      },
      {
        id: "1-2-8",
        "name": "ชั้น 8"
      },
      {
        id: "1-2-9",
        "name": "ชั้น 9"
      }
    ],
    images: [
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSTccE3QOmCq-KCUu6xNCGvYj4Q5IDkX4eqTg&s",
      "https://bpuu.kmutt.ac.th/wp-content/uploads/2019/09/Car1-scaled.jpg",
      "https://bpuu.kmutt.ac.th/wp-content/uploads/2019/09/Car3.jpg"
    ],
    status: "available",
    capacity: {
      ev: 0,
      normal: 366,
      motorcycle: 0
    },
    distance: 0,
    schedule: [
      {
        cron: {
          "open": "0 8 * * *",
          "close": "0 20 * * *"
        },
        days: [],
        open_time: "08:00",
        close_time: "20:00"
      }
    ],
    available: {
      ev: 0,
      normal: 366,
      motorcycle: 0
    },
    priceUnit: "ฟรี",
    userTypes: "นศ., บุคลากร",
    hasEVCharger: false,
    isBookmarked: false,
    supportedTypes: [
      "normal"
    ]
  },
  // --- Visitor Buildings ---
  {
    id: 'school-building-01',
    name: 'อาคารเรียนรวม 12 ชั้น (E12)',
    category: 'building',
    zone: 'north',
    capacity: { normal: 50, ev: 0, motorcycle: 20 },
    available: { normal: 10, ev: 0, motorcycle: 5 },
    floors: ['G', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
    mapX: 0, mapY: 0,
    lat: 13.727549,
    lng: 100.772554,
    status: 'low',
    isBookmarked: false,
    distance: 200,
    hours: '08:00 - 18:00',
    hasEVCharger: false,
    userTypes: 'Visitor, Student',
    price: 20,
    priceUnit: 'ต่อชม.',
    supportedTypes: ['normal', 'motorcycle'],
    schedule: [],
    images: ['assets/images/parking/indoor.png']
  },
  {
    id: 'visitor_bldg_2',
    name: 'อาคารนวัตกรรม (Innovation Bldg)',
    category: 'building',
    zone: 'south',
    capacity: { normal: 80, ev: 10, motorcycle: 30 },
    available: { normal: 0, ev: 2, motorcycle: 0 },
    floors: ['B1', 'B2'],
    mapX: 0, mapY: 0,
    lat: 13.651000,
    lng: 100.497000,
    status: 'full',
    isBookmarked: false,
    distance: 600,
    hours: '',
    hasEVCharger: true,
    userTypes: 'Visitor',
    price: 30,
    priceUnit: 'ต่อชม.',
    supportedTypes: ['normal', 'ev', 'motorcycle'],
    schedule: [],
    images: ['assets/images/parking/exterior.png']
  },
  {
    id: 'visitor_bldg_complex',
    name: 'อาคารสำนักงานอธิการบดี (Office Zone A)',
    category: 'building',
    zone: 'north',
    capacity: { normal: 40, ev: 5, motorcycle: 10 },
    available: { normal: 35, ev: 5, motorcycle: 8 },
    floors: ['G', 'P1'],
    mapX: 0, mapY: 0,
    lat: 13.651500,
    lng: 100.496000,
    status: 'available',
    isBookmarked: true,
    distance: 150,
    hours: '',
    hasEVCharger: true,
    userTypes: 'Visitor, Staff',
    price: 20,
    priceUnit: 'ต่อชม.',
    supportedTypes: ['normal', 'ev'],
    schedule: [],
    images: ['assets/images/parking/exterior.png']
  },
  {
    id: 'visitor_bldg_library',
    name: 'ลานจอดข้างหอสมุด (Zone B)',
    category: 'building',
    zone: 'south',
    capacity: { normal: 60, ev: 0, motorcycle: 40 },
    available: { normal: 12, ev: 0, motorcycle: 20 },
    floors: ['G'],
    mapX: 0, mapY: 0,
    lat: 13.652200,
    lng: 100.495500,
    status: 'low',
    isBookmarked: false,
    distance: 300,
    hours: '',
    hasEVCharger: false,
    userTypes: 'Visitor',
    price: 10,
    priceUnit: 'ต่อชม.',
    supportedTypes: ['normal', 'motorcycle'],
    schedule: [],
    images: ['assets/images/parking/outdoor.png']
  }
];

// =======================================================
// MOCK DATA FOR TAB 2 (Bookings & History)
// =======================================================

export const TAB2_BOOKINGS: Booking[] = [];

// =======================================================
// MOCK DATA FOR TAB 3 (Profile & Settings)
// =======================================================

export const TAB3_USER_PROFILE: UserProfile = {
  name: 'Atsadawut FastPass',
  phone: '+66 81 234 5678',
  avatar: 'https://i.pravatar.cc/150?u=somorn',
  role: 'Visitor',
  lineId: 'line_id_example',
  email: 'user@example.com'
};

export const TAB3_VEHICLES: Vehicle[] = [
  {
    id: 1,
    model: 'TOYOTA YARIS',
    licensePlate: '1กข 1234',
    province: 'กรุงเทพฯ',
    image:
      'https://img.freepik.com/free-photo/red-car-street_114579-4017.jpg?t=st=1735398000~exp=1735401600~hmac=8a892b0c34567de',
    isDefault: true,
    status: 'พร้อมใช้งาน',
    lastUpdate: '2 พ.ย. 2568, 09:29 น.',
    rank: 2,
  },
  {
    id: 2,
    model: 'MAZDA 3',
    licensePlate: '5กง 9999',
    province: 'กรุงเทพฯ',
    image:
      'https://img.freepik.com/free-photo/grey-metallic-car_114579-4061.jpg',
    isDefault: false,
    status: '',
    lastUpdate: '24 ต.ค. 2568, 13:38 น.',
    rank: 1,
  },
  {
    id: 3,
    model: 'HONDA PCX150',
    licensePlate: '3กค 5678',
    province: 'กรุงเทพฯ',
    image:
      'https://img.freepik.com/free-photo/scooter-motorcycle_114579-7988.jpg',
    isDefault: false,
    status: '',
    lastUpdate: '',
    rank: 3,
  },
];

export const TAB3_GENERAL_SETTINGS: SettingItem[] = [
  { title: 'เปลี่ยนรหัสผ่าน', icon: 'lock-closed-outline' },
  { title: 'ตั้งค่าการแจ้งเตือน', icon: 'notifications-outline' },
  { title: 'ภาษา', icon: 'language-outline' },
];

export const TAB3_OTHER_SETTINGS: SettingItem[] = [
  { title: 'เกี่ยวกับเรา', icon: 'information-circle-outline' },
  { title: 'เงื่อนไขการใช้งาน', icon: 'document-text-outline' },
  { title: 'นโยบายความเป็นส่วนตัว', icon: 'shield-checkmark-outline' },
  {
    title: 'เวอร์ชันแอปพลิเคชัน',
    value: '1.0.0',
    icon: 'phone-portrait-outline',
  },
];

// =======================================================
// MOCK DATA FOR PARKING DETAIL COMPONENT (Site Dropdown)
// =======================================================

export const PARKING_DETAIL_MOCK_SITES: ParkingLot[] = [
  {
    id: 'lib_complex',
    name: 'อาคารหอสมุด (Library)',
    capacity: { normal: 100, ev: 100, motorcycle: 100 },
    available: { normal: 100, ev: 100, motorcycle: 100 },
    floors: ['Floor 1', 'Floor 2', 'Floor 3'],
    mapX: 50,
    mapY: 80,
    status: 'available',
    isBookmarked: true,
    distance: 50,
    hours: '',
    hasEVCharger: true,
    userTypes: 'นศ., บุคลากร',
    price: 0,
    priceUnit: 'ฟรี',
    supportedTypes: ['normal', 'ev', 'motorcycle'],
    schedule: [],
    images: [
      'assets/images/parking/exterior.png',
      'assets/images/parking/indoor.png',
    ],
  },
  {
    id: 'ev_station_1',
    name: 'สถานีชาร์จ EV (ตึก S11)',
    capacity: { normal: 100, ev: 100, motorcycle: 100 },
    available: { normal: 100, ev: 100, motorcycle: 100 },
    floors: ['G'],
    mapX: 300,
    mapY: 150,
    status: 'available',
    isBookmarked: false,
    distance: 500,
    hours: '',
    hasEVCharger: true,
    userTypes: 'All',
    price: 50,
    priceUnit: 'ต่อชม.',
    supportedTypes: ['ev'],
    schedule: [],
    images: ['assets/images/parking/ev.png'],
  },
];
