/**
 * Service for Google Sheets and Google Drive integration
 * Uses REST API with OAuth Bearer token obtained client-side
 */


async function googleApiError(response: Response, fallback: string): Promise<Error> {
  const errorData = await response.json().catch(() => null);
  const message = errorData?.error?.message;
  return new Error(typeof message === 'string' && message.trim() ? message : fallback);
}

export interface GoogleSpreadsheetInfo {
  spreadsheetId: string;
  spreadsheetUrl: string;
  title: string;
}

/**
 * Creates a new Google Spreadsheet in the user's Google Drive
 */
export async function createSpreadsheet(
  accessToken: string,
  title: string = 'منظومة جرد أصول وعهد تقنية المعلومات'
): Promise<GoogleSpreadsheetInfo> {
  const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        title,
      },
      sheets: [
        {
          properties: {
            title: 'الأجهزة والجرد',
            gridProperties: { rowCount: 100, columnCount: 15 },
          },
        },
        {
          properties: {
            title: 'بطاقات العهدة',
            gridProperties: { rowCount: 100, columnCount: 12 },
          },
        },
      ],
    }),
  });

  if (!response.ok) {
    throw await googleApiError(response, 'تعذر إنشاء جدول البيانات في Google Sheets');
  }

  const data = await response.json();
  return {
    spreadsheetId: data.spreadsheetId,
    spreadsheetUrl: data.spreadsheetUrl,
    title: data.properties.title,
  };
}

/**
 * Read spreadsheet metadata and verify that the integration's required tabs exist.
 * This validates both the spreadsheet ID and the caller's access without assuming
 * that a particular range is already populated.
 */
export async function getSpreadsheetInfo(
  accessToken: string,
  spreadsheetId: string
): Promise<GoogleSpreadsheetInfo> {
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,spreadsheetUrl,properties(title),sheets(properties(title))`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    throw await googleApiError(response, 'تعذر الوصول إلى جدول Google Sheets أو لا تملك صلاحية فتحه');
  }

  const data = await response.json();
  const availableTabs = (data.sheets || [])
    .map((sheet: { properties?: { title?: string } }) => sheet.properties?.title)
    .filter((title: string | undefined): title is string => Boolean(title));
  const requiredTabs = ['الأجهزة والجرد', 'بطاقات العهدة'];
  const missingTabs = requiredTabs.filter((title) => !availableTabs.includes(title));

  if (missingTabs.length > 0) {
    throw new Error(
      `تم الوصول إلى الجدول، لكن تنقصه الأوراق التالية المطلوبة للمزامنة: ${missingTabs.join('، ')}. أضفها بالأسماء نفسها ثم أعد الربط.`
    );
  }

  return {
    spreadsheetId: data.spreadsheetId,
    spreadsheetUrl: data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}/edit`,
    title: data.properties?.title || 'جدول Google Sheets',
  };
}

/**
 * Push all assets and custody cards to the Google Spreadsheet
 */
export async function syncDataToGoogleSheet(
  accessToken: string,
  spreadsheetId: string,
  assets: any[],
  custodyCards: any[]
): Promise<void> {
  // 1. Assets sheet headers and rows
  const assetHeaders = [
    'الرقم التعريفي (ID)',
    'الشركة المصنعة',
    'الموديل',
    'التصنيف',
    'الرقم التسلسلي (SN)',
    'المكتب / الموقع',
    'الحالة الحالية',
    'المعالج (CPU)',
    'الذاكرة (RAM)',
    'التخزين',
    'تاريخ الاستلام',
  ];

  const assetRows = assets.map((a) => [
    a.id || '',
    a.brand || '',
    a.model || '',
    a.category || '',
    a.serialNumber || '',
    a.officeName || 'المستودع الرئيسي',
    a.status || 'available',
    a.cpu || '',
    a.ram || '',
    a.storage || '',
    a.receivedAt ? new Date(a.receivedAt).toLocaleDateString('ar-EG') : '',
  ]);

  // 2. Custody cards headers matching the official warehouse paper form
  const custodyHeaders = [
    'رقم بطاقة العهدة',
    'الاسم الثلاثي للمسؤول',
    'الصفة',
    'المديرية',
    'الدائرة',
    'المكتب / الغرفة',
    'مسلسل',
    'اسم المادة',
    'أوصافها',
    'الوحدة',
    'الكمية رقماً',
    'الكمية كتابة',
    'رمزها',
    'بطاقتها',
    'استلام العهدة - رقم المذكرة',
    'استلام العهدة - تاريخها',
    'إعادة العهدة - رقم المذكرة',
    'إعادة العهدة - تاريخها',
    'الرصيد',
    'ملاحظات',
  ];

  const custodyRows: (string | number)[][] = [];

  custodyCards.forEach((c) => {
    const respName = c.responsibleName || c.employeeName || '';
    const role = c.roleTitle || '';
    const dir = c.directorate || '';
    const dept = c.department || '';
    const off = c.officeName || '';
    const cardNum = c.cardNumber || c.id;

    if (c.items && c.items.length > 0) {
      c.items.forEach((item: any, idx: number) => {
        custodyRows.push([
          cardNum,
          respName,
          role,
          dir,
          dept,
          off,
          item.seq || idx + 1,
          item.itemName || '',
          item.itemDescription || '',
          item.unit || 'جهاز',
          item.quantityNumber ?? 1,
          item.quantityText || 'واحد فقط',
          item.itemCode || '',
          item.cardCode || '',
          item.receiptDocNumber || '',
          item.receiptDate || (c.assignedAt ? new Date(c.assignedAt).toLocaleDateString('ar-EG') : ''),
          item.returnDocNumber || '',
          item.returnDate || '',
          item.balance ?? 1,
          item.notes || c.notes || '',
        ]);
      });
    } else {
      custodyRows.push([
        cardNum,
        respName,
        role,
        dir,
        dept,
        off,
        1,
        c.assetLabel || 'أصل تقني',
        c.notes || '',
        'جهاز',
        1,
        'واحد فقط',
        c.assetId || '',
        cardNum,
        '',
        c.assignedAt ? new Date(c.assignedAt).toLocaleDateString('ar-EG') : '',
        '',
        '',
        1,
        c.notes || '',
      ]);
    }
  });

  // Update sheets via batchUpdate values
  const payload = {
    // RAW stores imported/user-provided strings literally and prevents formula injection.
    valueInputOption: 'RAW',
    data: [
      {
        range: "'الأجهزة والجرد'!A1:K" + (assetRows.length + 1),
        values: [assetHeaders, ...assetRows],
      },
      {
        range: "'بطاقات العهدة'!A1:T" + (custodyRows.length + 1),
        values: [custodyHeaders, ...custodyRows],
      },
    ],
  };

  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    throw await googleApiError(response, 'تعذر إرسال البيانات إلى Google Sheets');
  }

  // The app exports a full snapshot. Remove leftover rows from a previous,
  // larger export so deleted assets/custody items do not remain in the sheet.
  const clearRanges = [
    `'الأجهزة والجرد'!A${assetRows.length + 2}:K`,
    `'بطاقات العهدة'!A${custodyRows.length + 2}:T`,
  ];
  const clearResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchClear`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ranges: clearRanges }),
    }
  );

  if (!clearResponse.ok) {
    throw await googleApiError(
      clearResponse,
      'تم إرسال البيانات، لكن تعذر تنظيف الصفوف القديمة الزائدة في Google Sheets. أعد المزامنة.'
    );
  }
}

/**
 * Fetch rows from Google Sheet to import or update in the app
 */
export async function fetchSheetValues(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string = 'الأجهزة والجرد'
): Promise<string[][]> {
  const encodedRange = encodeURIComponent(`${sheetName}!A1:Z500`);
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodedRange}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    throw await googleApiError(response, 'تعذر جلب البيانات من Google Sheet');
  }

  const data = await response.json();
  return data.values || [];
}
