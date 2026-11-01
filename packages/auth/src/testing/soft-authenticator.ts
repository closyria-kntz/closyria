// A software WebAuthn authenticator for tests: ES256 (P-256) keys from node:crypto, "none"
// attestation, encoded by hand (CBOR, authenticator data, client data) so the server's
// verification library is checked against an independent implementation.
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";

const b64url = (bytes: Uint8Array | string) => Buffer.from(bytes).toString("base64url");
const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest();

type Cbor = number | string | Uint8Array | Map<Cbor, Cbor> | Record<string, never>;

function cborHead(major: number, value: number): Buffer {
  if (value < 24) return Buffer.from([(major << 5) | value]);
  if (value < 0x100) return Buffer.from([(major << 5) | 24, value]);
  if (value < 0x10000) return Buffer.from([(major << 5) | 25, value >> 8, value & 0xff]);
  const out = Buffer.alloc(5);
  out[0] = (major << 5) | 26;
  out.writeUInt32BE(value, 1);
  return out;
}

/** The subset of CBOR (RFC 8949) WebAuthn needs: integers, byte and text strings, maps. */
function cbor(value: Cbor): Buffer {
  if (typeof value === "number") return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);
  if (typeof value === "string") {
    const bytes = Buffer.from(value, "utf8");
    return Buffer.concat([cborHead(3, bytes.length), bytes]);
  }
  if (value instanceof Uint8Array) return Buffer.concat([cborHead(2, value.length), value]);
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value);
  return Buffer.concat([cborHead(5, entries.length), ...entries.flatMap(([k, v]) => [cbor(k), cbor(v)])]);
}

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_DATA = 0x40;

function counterBytes(counter: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(counter);
  return out;
}

type RegistrationOptions = { challenge: string; rp: { id?: string } };
type AuthenticationOptions = { challenge: string; rpId?: string };

/** One authenticator holding one credential, like a phone's platform passkey. */
export function softAuthenticator(origin: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const credentialId = randomBytes(32);
  let counter = 0;

  const clientData = (type: "webauthn.create" | "webauthn.get", challenge: string) =>
    Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));

  return {
    credentialId: b64url(credentialId),

    /** navigator.credentials.create(), serialised the way @simplewebauthn/browser sends it. */
    register(options: RegistrationOptions, { userVerified = true } = {}) {
      const rpId = options.rp.id ?? new URL(origin).hostname;
      const cosePublicKey = new Map<Cbor, Cbor>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, Buffer.from(jwk.x ?? "", "base64url")],
        [-3, Buffer.from(jwk.y ?? "", "base64url")],
      ]);
      const credentialIdLength = Buffer.alloc(2);
      credentialIdLength.writeUInt16BE(credentialId.length);
      const authData = Buffer.concat([
        sha256(rpId),
        Buffer.from([FLAG_USER_PRESENT | (userVerified ? FLAG_USER_VERIFIED : 0) | FLAG_ATTESTED_DATA]),
        counterBytes(counter),
        Buffer.alloc(16), // AAGUID: all zeros, as with "none" attestation
        credentialIdLength,
        credentialId,
        cbor(cosePublicKey),
      ]);
      const attestationObject = cbor(
        new Map<Cbor, Cbor>([
          ["fmt", "none"],
          ["attStmt", {}],
          ["authData", authData],
        ]),
      );
      return {
        id: b64url(credentialId),
        rawId: b64url(credentialId),
        type: "public-key",
        authenticatorAttachment: "platform",
        clientExtensionResults: {},
        response: {
          clientDataJSON: b64url(clientData("webauthn.create", options.challenge)),
          attestationObject: b64url(attestationObject),
          transports: ["internal"],
        },
      };
    },

    /** navigator.credentials.get(), signed with the credential's private key. */
    authenticate(options: AuthenticationOptions, { tamper = false, userVerified = true } = {}) {
      const rpId = options.rpId ?? new URL(origin).hostname;
      counter += 1;
      const authenticatorData = Buffer.concat([
        sha256(rpId),
        Buffer.from([FLAG_USER_PRESENT | (userVerified ? FLAG_USER_VERIFIED : 0)]),
        counterBytes(counter),
      ]);
      const clientDataJSON = clientData("webauthn.get", options.challenge);
      const signature = sign("sha256", Buffer.concat([authenticatorData, sha256(clientDataJSON)]), privateKey);
      if (tamper) signature.writeUInt8(signature.readUInt8(signature.length - 1) ^ 0xff, signature.length - 1);
      return {
        id: b64url(credentialId),
        rawId: b64url(credentialId),
        type: "public-key",
        authenticatorAttachment: "platform",
        clientExtensionResults: {},
        response: {
          clientDataJSON: b64url(clientDataJSON),
          authenticatorData: b64url(authenticatorData),
          signature: b64url(signature),
        },
      };
    },
  };
}
