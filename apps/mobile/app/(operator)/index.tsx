import { View, Text, StyleSheet } from 'react-native';

export default function OperatorRequests() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Solicitudes Disponibles</Text>
      <Text style={styles.subtitle}>Lista de solicitudes por zona (por implementar)</Text>
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
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
});
