import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Link } from 'expo-router';

export default function Home() {
  // Flatten style arrays to prevent "CSSStyleDeclaration" crash on web
  // When using Link asChild, expo-router (via Radix Slot) forwards styles to DOM
  // DOM cannot handle style arrays, only objects
  const secondaryButtonStyle = StyleSheet.flatten([styles.button, styles.secondaryButton]);
  const secondaryTextStyle = StyleSheet.flatten([styles.buttonText, styles.secondaryButtonText]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Gruas App</Text>
      <Text style={styles.subtitle}>El Salvador</Text>

      <View style={styles.buttonContainer}>
        <Link href="/(auth)/login" asChild>
          <TouchableOpacity style={styles.button}>
            <Text style={styles.buttonText}>Iniciar Sesión</Text>
          </TouchableOpacity>
        </Link>

        <Link href="/(auth)/register" asChild>
          <TouchableOpacity style={secondaryButtonStyle}>
            <Text style={secondaryTextStyle}>Registrarse</Text>
          </TouchableOpacity>
        </Link>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: '#666',
    marginBottom: 48,
  },
  buttonContainer: {
    width: '100%',
    gap: 16,
  },
  button: {
    backgroundColor: '#2563eb',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#2563eb',
  },
  secondaryButtonText: {
    color: '#2563eb',
  },
});
