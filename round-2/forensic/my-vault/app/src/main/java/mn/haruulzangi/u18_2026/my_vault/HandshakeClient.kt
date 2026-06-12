package mn.haruulzangi.u18_2026.my_vault

import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encodeToString
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

class HandshakeClient(
    private val endpoint: String,
    private val client: OkHttpClient = OkHttpClient(),
) {
    suspend fun retrieveEncryptedFlag(
        publicKey: ByteArray,
        clientNonce: ByteArray,
        attestationCertificates: List<ByteArray>,
    ): EncryptedFlagResponse = withContext(Dispatchers.IO) {
        // Handshake v1 uses RSA/ECB/OAEPWithSHA-256AndMGF1Padding for the returned session key.
        val requestBody = HandshakeRequest(
            clientNonce = clientNonce,
            publicKey = publicKey,
            attestationCertificates = attestationCertificates.map {
                Base64.encodeToString(it, Base64.NO_WRAP)
            },
        )
            .let { FLAG_JSON.encodeToString(it) }
            .toRequestBody(JSON)

        val request = Request.Builder()
            .url(endpoint)
            .post(requestBody)
            .build()

        client.newCall(request).execute().use { response ->
            if (response.code == 403) {
                throw DeviceNotSecureException()
            }
            if (!response.isSuccessful) {
                throw IOException("Handshake failed with HTTP ${response.code}")
            }

            val body = response.body?.string()
                ?: throw IOException("Handshake response was empty")
            parseEncryptedFlagResponse(body)
        }
    }

    private fun parseEncryptedFlagResponse(body: String): EncryptedFlagResponse {
        val json = FLAG_JSON.decodeFromString<EncryptedFlagResponseJson>(body)
        return EncryptedFlagResponse(
            encryptedSessionKey = json.encryptedSessionKey,
            flagIv = json.flagIv,
            encryptedFlag = json.encryptedFlag,
            aad = json.aad,
        )
    }

    private companion object {
        val FLAG_JSON = Json {
            ignoreUnknownKeys = true
        }
        val JSON = "application/json; charset=utf-8".toMediaType()
    }
}

@Serializable
private data class HandshakeRequest(
    @Serializable(with = Base64ByteArraySerializer::class)
    val clientNonce: ByteArray,
    @Serializable(with = Base64ByteArraySerializer::class)
    val publicKey: ByteArray,
    val attestationCertificates: List<String>,
)

@Serializable
private data class EncryptedFlagResponseJson(
    @Serializable(with = Base64ByteArraySerializer::class)
    val encryptedSessionKey: ByteArray,
    @Serializable(with = Base64ByteArraySerializer::class)
    val flagIv: ByteArray,
    @Serializable(with = Base64ByteArraySerializer::class)
    val encryptedFlag: ByteArray,
    @Serializable(with = Base64ByteArraySerializer::class)
    val aad: ByteArray? = null,
)

private object Base64ByteArraySerializer : KSerializer<ByteArray> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("Base64ByteArray", PrimitiveKind.STRING)

    override fun serialize(encoder: Encoder, value: ByteArray) {
        encoder.encodeString(Base64.encodeToString(value, Base64.NO_WRAP))
    }

    override fun deserialize(decoder: Decoder): ByteArray {
        val encoded = decoder.decodeString()
        if (encoded.isBlank()) {
            throw SerializationException("Expected non-empty base64 string")
        }
        return try {
            Base64.decode(encoded, Base64.NO_WRAP)
        } catch (error: IllegalArgumentException) {
            throw SerializationException("Invalid base64 string", error)
        }
    }
}

data class EncryptedFlagResponse(
    val encryptedSessionKey: ByteArray,
    val flagIv: ByteArray,
    val encryptedFlag: ByteArray,
    val aad: ByteArray?,
)
