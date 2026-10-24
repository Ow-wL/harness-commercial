"""EPSG:5174 (Bessel 중부원점 TM, 보정 없음 — 행안부 인허가 좌표) → WGS84 위경도. pyproj 없이 계산 (부평동 PC방 위치로 확인)."""
import numpy as np
A_B, F_B = 6377397.155, 1 / 299.1528128
A_W, F_W = 6378137.0, 1 / 298.257223563
LAT0, LON0, K0, X0, Y0 = np.radians(38.0), np.radians(127.0028902777778), 1.0, 200000.0, 500000.0
TOWGS = (-115.80, 474.99, 674.11, 1.16, -2.31, -1.63, 6.43)

def _inv_tm(x, y, a, f):
    e2 = f * (2 - f); ep2 = e2 / (1 - e2)
    def M(phi):
        return a * ((1 - e2/4 - 3*e2**2/64 - 5*e2**3/256) * phi - (3*e2/8 + 3*e2**2/32 + 45*e2**3/1024) * np.sin(2*phi)
                    + (15*e2**2/256 + 45*e2**3/1024) * np.sin(4*phi) - (35*e2**3/3072) * np.sin(6*phi))
    m = M(LAT0) + (y - Y0) / K0
    mu = m / (a * (1 - e2/4 - 3*e2**2/64 - 5*e2**3/256))
    e1 = (1 - np.sqrt(1 - e2)) / (1 + np.sqrt(1 - e2))
    p1 = mu + (3*e1/2 - 27*e1**3/32) * np.sin(2*mu) + (21*e1**2/16 - 55*e1**4/32) * np.sin(4*mu) \
         + (151*e1**3/96) * np.sin(6*mu) + (1097*e1**4/512) * np.sin(8*mu)
    C1 = ep2 * np.cos(p1)**2; T1 = np.tan(p1)**2
    N1 = a / np.sqrt(1 - e2 * np.sin(p1)**2); R1 = a * (1 - e2) / (1 - e2 * np.sin(p1)**2)**1.5
    D = (x - X0) / (N1 * K0)
    lat = p1 - (N1 * np.tan(p1) / R1) * (D**2/2 - (5 + 3*T1 + 10*C1 - 4*C1**2 - 9*ep2) * D**4/24
                                         + (61 + 90*T1 + 298*C1 + 45*T1**2 - 252*ep2 - 3*C1**2) * D**6/720)
    lon = LON0 + (D - (1 + 2*T1 + C1) * D**3/6 + (5 - 2*C1 + 28*T1 - 3*C1**2 + 8*ep2 + 24*T1**2) * D**5/120) / np.cos(p1)
    return lat, lon

def _to_ecef(lat, lon, a, f):
    e2 = f * (2 - f); N = a / np.sqrt(1 - e2 * np.sin(lat)**2)
    return N*np.cos(lat)*np.cos(lon), N*np.cos(lat)*np.sin(lon), N*(1-e2)*np.sin(lat)

def _from_ecef(X, Y, Z, a, f):
    e2 = f * (2 - f); b = a * (1 - f); ep2 = (a*a - b*b) / (b*b)
    p = np.sqrt(X*X + Y*Y); th = np.arctan2(Z * a, p * b)
    lat = np.arctan2(Z + ep2 * b * np.sin(th)**3, p - e2 * a * np.cos(th)**3)
    return lat, np.arctan2(Y, X)

def to_wgs84(x, y):
    x, y = np.asarray(x, float), np.asarray(y, float)
    lat, lon = _inv_tm(x, y, A_B, F_B)
    X, Y, Z = _to_ecef(lat, lon, A_B, F_B)
    dx, dy, dz, rx, ry, rz, s = TOWGS
    rx, ry, rz = [np.radians(v / 3600) for v in (rx, ry, rz)]; s = 1 + s * 1e-6
    X2 = dx + s * (X - rz * Y + ry * Z); Y2 = dy + s * (rz * X + Y - rx * Z); Z2 = dz + s * (-ry * X + rx * Y + Z)
    lat, lon = _from_ecef(X2, Y2, Z2, A_W, F_W)
    return np.degrees(lat), np.degrees(lon)
